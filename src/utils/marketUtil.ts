import { Location, LocationWithMarketplace, Marketplace, YourShip } from "spacetraders-sdk/dist/types";
import * as globals from "./globals";
import * as _ from "lodash";
import { IntraSystemTrader } from "../classes/IntraSystemTrader";
import { Goods } from "../types";
import { LocationScout } from "../classes/LocationScout";
import WebSocket from 'isomorphic-ws';

const noFuelLocations = ["XV-BN"];

export interface FuelTarget {
  targetDest: string;
  fuelNeeded: number;
}

export class MarketUtil {
  public static calculateFuelNeededForGood(
    ship: YourShip,
    good?: string
  ): FuelTarget {
    const systemLocations = globals.locationMap.get(
      ship.location.substring(0, 2)
    );
    // Need both conditions.  When determing distance for buying purposes, the cargo will always be empty.  When determining navigation, cargo should never be empty
    if (ship.cargo.length > 0 || !_.isEmpty(good)) {
      let goodToShip: string;
      if (good) {
        goodToShip = good;
      } else {
        if (ship.cargo.length > 1)
          goodToShip = ship.cargo.find((good) => {
            return good.good !== "FUEL";
          })?.good;
        else
          goodToShip = ship.cargo[0].good;
      }
      if (goodToShip) {
        const systemGoods = globals.bestRoutesPerSystem.get(
          ship.location.substring(0, 2)
        );
        const goodMarketData = systemGoods.find((good) => {
          return good.symbol === goodToShip;
        });
        if (goodMarketData && goodMarketData.highLoc) {
          const targetDest = systemLocations.find((loc) => {
            return loc.symbol === goodMarketData.highLoc && loc.symbol;
          });
          const currentLoc = systemLocations.find((loc) => {
            return loc.symbol === ship.location;
          });
          if (
            targetDest &&
            currentLoc &&
            targetDest.symbol !== currentLoc.symbol
          ) {
            const distanceToMarket = this.distance(targetDest, currentLoc);
            let penalty = 0;
            if (currentLoc.type.toLowerCase() === "planet") {
              penalty += 2;
              penalty += ship.class === "MK-II" ? 1 : 0;
              penalty += ship.class === "MK-III" ? 2 : 0;
            }
            let fuelNeeded = Math.round(distanceToMarket / 4) + penalty + 1;
            if (noFuelLocations.includes(targetDest.symbol))
              fuelNeeded = fuelNeeded * 2;

            fuelNeeded -=
              ship.cargo.find((item) => item.good === "FUEL")?.quantity || 0;
            if (fuelNeeded < 0) fuelNeeded = 0;
            return { targetDest: targetDest.symbol, fuelNeeded };
          } else {
            return this.backupNavigation(systemLocations, ship);
          }
        } else {
          return this.backupNavigation(systemLocations, ship);
        }
      } else {
        return this.backupNavigation(systemLocations, ship);
      }
    } else {
      return this.backupNavigation(systemLocations, ship);
    }
  }

  private static backupNavigation(
    systemLocs: Location[],
    ship: YourShip
  ): FuelTarget {
    const systemGoods = globals.bestRoutesPerSystem.get(
      ship.location.substring(0, 2)
    );
    let orderedMarket = _.orderBy(systemGoods, ["cdv"], ["desc"]);
    let targetDest = systemLocs.find(
      (loc) =>
        loc.symbol === orderedMarket[0].lowLoc && loc.symbol !== ship.location
    );
    if (!targetDest) {
      targetDest = systemLocs.find((loc) => loc.symbol !== ship.location);
    }
    const currentLoc = systemLocs.find((loc) => loc.symbol === ship.location);
    const tripDist = this.distance(targetDest, currentLoc);

    let penalty = 0;
    if (currentLoc.type.toLowerCase() === "planet") {
      penalty += 2;
      penalty += ship.class === "MK-II" ? 1 : 0;
      penalty += ship.class === "MK-III" ? 2 : 0;
    }
    let fuelNeeded = Math.round(tripDist / 4) + penalty + 1;
    fuelNeeded -=
      ship.cargo.find((item) => item.good === "FUEL")?.quantity || 0;
    if (fuelNeeded < 0) fuelNeeded = 0;

    return { targetDest: targetDest.symbol, fuelNeeded };
  }

  public static distance(loc1: Location, loc2: Location) {
    const xdiff = Math.pow(loc2.x - loc1.x, 2);
    const ydiff = Math.pow(loc2.y - loc1.y, 2);
    return Math.ceil(Math.sqrt(xdiff + ydiff));
  }

  public static async updateMarketData() {
    for (let [system, markets] of globals.universeMarkets) {
      await Promise.all(
        [
          ...new Set(
            globals.getAllShips()
              .filter(
                (ship) =>
                ship.location !== undefined && ship.location.substring(0,2) === system
              )
              .map((ship) => ship.location)
          ),
        ].map((loc) => {
          return globals.spaceTraders.getMarketplace(loc);
        })
      ).then((data) => {
        let marketData = data.map(x => x.location);
        for (let market of markets) {
            if (!marketData.find(mar => mar.symbol === market.symbol)) {
                marketData.push(market);
            }
        }
        globals.universeMarkets.set(system, marketData);
      });
    }

    this.calculateBestIntraSystemRoutes();
    this.calculateBestInterSystemRoutes();
  }

  private static calculateBestIntraSystemRoutes() {
    for (const [system, markets] of globals.universeMarkets) {
      let priceMap: Goods[] = [];
      for (const market of markets) {
        for (const goods of market.marketplace) {
          let item = priceMap.find((good) => good.symbol === goods.symbol);
          const oldItem = _.cloneDeep(item);
          let itemIndex = priceMap.indexOf(item);
          if (item) {
            const lowMarket = markets.find(
              (mar) => mar.symbol === item.lowLoc
            );
            const highMarket = markets.find(
              (mar) => mar.symbol === item.highLoc
            );
            const lowToCurrDist = MarketUtil.distance(lowMarket, market);
            const highToCurrDist = MarketUtil.distance(highMarket, market);

            const currentCDV = item.cdv;
            const newLowCDV =
              (item.highPrice - goods.purchasePricePerUnit) /
              highToCurrDist /
              goods.volumePerUnit;
            const newHighCDV =
              (goods.sellPricePerUnit - item.lowPrice) /
              lowToCurrDist /
              goods.volumePerUnit;

            if (
              (newLowCDV > currentCDV && newLowCDV !== Infinity) ||
              item.lowLoc === market.symbol
            ) {
              item.lowPrice = goods.purchasePricePerUnit;
              item.lowLoc = market.symbol;
            }

            if (
              (newHighCDV > currentCDV && newHighCDV !== Infinity) ||
              item.highLoc === market.symbol
            ) {
              item.highPrice = goods.sellPricePerUnit;
              item.highLoc = market.symbol;
            }

            if (item.lowLoc === item.highLoc) {
              if (newLowCDV >= newHighCDV && newLowCDV >= currentCDV) {
                item.highPrice = oldItem.highPrice;
                item.highLoc = oldItem.highLoc;
              } else if (newHighCDV > newLowCDV && newHighCDV >= currentCDV) {
                item.lowPrice = oldItem.lowPrice;
                item.lowLoc = oldItem.lowLoc;
              }
            }
            const newDist = MarketUtil.distance(
              markets.find((loc) => loc.symbol === item.highLoc),
              markets.find((loc) => loc.symbol === item.lowLoc)
            );
            item.cdv =
              (item.highPrice - item.lowPrice) /
              (newDist === 0 ? 1 : newDist) /
              item.volume;
            // console.log("Good: "+goods.symbol+" High CDV: "+newHighCDV+" Low CDV: "+newLowCDV+" Current CDV: "+currentCDV);
            priceMap[itemIndex] = item;
          } else {
            priceMap.push({
              symbol: goods.symbol,
              lowPrice: goods.purchasePricePerUnit,
              highPrice: goods.sellPricePerUnit,
              lowLoc: market.symbol,
              highLoc: market.symbol,
              volume: goods.volumePerUnit,
              cdv: -100,
            });
          }
        }
      }
      globals.bestRoutesPerSystem.set(system, priceMap);
    }
  }

  private static calculateBestInterSystemRoutes() {
    let markets: LocationWithMarketplace[] = [];
    for (const [system, systemMarkets] of globals.universeMarkets) {
      markets = markets.concat(systemMarkets);
    }
    let priceMap: Goods[] = [];
    for (const market of markets) {
      for (const goods of market.marketplace) {
        let item = priceMap.find((good) => good.symbol === goods.symbol);
        const oldItem = _.cloneDeep(item);
        let itemIndex = priceMap.indexOf(item);
        if (item) {
          const lowMarket = markets.find(
            (mar) => mar.symbol === item.lowLoc
          );
          const highMarket = markets.find(
            (mar) => mar.symbol === item.highLoc
          );
          const lowMarketWarpGate = markets.find((mar) => mar.symbol === globals.systemWarpGate.get(item.lowLoc.substring(0,2)));
          const highMarketWarpGate = markets.find((mar) => mar.symbol === globals.systemWarpGate.get(item.highLoc.substring(0,2)));
          const currMarketWarpGate = markets.find((mar) => mar.symbol === globals.systemWarpGate.get(market.symbol.substring(0,2)));
          const lowToCurrDist = (item.lowLoc.substring(0,2) === market.symbol.substring(0,2)) ? MarketUtil.distance(lowMarket, market) : MarketUtil.distance(lowMarket, lowMarketWarpGate) + MarketUtil.distance(currMarketWarpGate, market);
          const highToCurrDist = (item.highLoc.substring(0,2) === market.symbol.substring(0,2)) ? MarketUtil.distance(highMarket, market) : MarketUtil.distance(highMarket, highMarketWarpGate) + MarketUtil.distance(currMarketWarpGate, market);

          const currentCDV = item.cdv;
          const newLowCDV =
            (item.highPrice - goods.purchasePricePerUnit) /
            highToCurrDist /
            goods.volumePerUnit;
          const newHighCDV =
            (goods.sellPricePerUnit - item.lowPrice) /
            lowToCurrDist /
            goods.volumePerUnit;

          if (
            (newLowCDV > currentCDV && newLowCDV !== Infinity) ||
            item.lowLoc === market.symbol
          ) {
            item.lowPrice = goods.purchasePricePerUnit;
            item.lowLoc = market.symbol;
          }

          if (
            (newHighCDV > currentCDV && newHighCDV !== Infinity) ||
            item.highLoc === market.symbol
          ) {
            item.highPrice = goods.sellPricePerUnit;
            item.highLoc = market.symbol;
          }

          if (item.lowLoc === item.highLoc) {
            if (newLowCDV >= newHighCDV && newLowCDV >= currentCDV) {
              item.highPrice = oldItem.highPrice;
              item.highLoc = oldItem.highLoc;
            } else if (newHighCDV > newLowCDV && newHighCDV >= currentCDV) {
              item.lowPrice = oldItem.lowPrice;
              item.lowLoc = oldItem.lowLoc;
            }
          }
          const newDist = MarketUtil.distance(
            markets.find((loc) => loc.symbol === item.highLoc),
            markets.find((loc) => loc.symbol === item.lowLoc)
          );
          item.cdv =
            (item.highPrice - item.lowPrice) /
            (newDist === 0 ? 1 : newDist) /
            item.volume;
          // console.log("Good: "+goods.symbol+" High CDV: "+newHighCDV+" Low CDV: "+newLowCDV+" Current CDV: "+currentCDV);
          priceMap[itemIndex] = item;
        } else {
          priceMap.push({
            symbol: goods.symbol,
            lowPrice: goods.purchasePricePerUnit,
            highPrice: goods.sellPricePerUnit,
            lowLoc: market.symbol,
            highLoc: market.symbol,
            volume: goods.volumePerUnit,
            cdv: -100,
          });
        }
      }
    }
    globals.setGlobalBestRoutes(priceMap);
  }


  public static startStreamingMarketData() {
    const ws = new WebSocket("https://dev.market.spacetraders.stream");

    ws.onopen = () => {
      ws.send('sync-locations');
    };

    ws.onmessage = (message: any) => {
      let marketData = JSON.parse(message.data);

      if (marketData.locations) {
        for (let system of globals.knownSystems) {
          let systemMarkets = marketData.locations.filter(loc => loc.symbol.substring(0,2) === system);
          globals.universeMarkets.set(system, systemMarkets);
        }
      } else {
        for (let marketIndex of marketData) {
          for(let location of Object.keys(marketIndex)) {
            let systemMarkets = globals.universeMarkets.get(location.substring(0,2));
            let locationMarketToUpdate = systemMarkets.find(mar => mar.symbol === location);
            let updateIndex = -1;
            if (locationMarketToUpdate) 
              updateIndex = systemMarkets.indexOf(locationMarketToUpdate);
            for(let good of marketIndex[location]) {
              let updateIndex = 0;
              if (locationMarketToUpdate) {
                let goodToUpdate = locationMarketToUpdate.marketplace.find(item => item.symbol === good.symbol);
                if (goodToUpdate) {
                  updateIndex = locationMarketToUpdate.marketplace.indexOf(goodToUpdate);
                }
                _.updateWith(locationMarketToUpdate, `marketplace[${updateIndex}]`, (value: Marketplace) => {
                  return Object.assign(value, good);
                }, Object);
              }
            }
            _.updateWith(systemMarkets, `[${updateIndex}]`, (value: LocationWithMarketplace) => {
              return Object.assign(value, locationMarketToUpdate);
            }, Object);
            globals.universeMarkets.set(location.substring(0,2), systemMarkets);
          }
        }
      }

      this.calculateBestIntraSystemRoutes();
      this.calculateBestInterSystemRoutes();
    }

    ws.onclose = () => {
      setTimeout(() => {
        this.startStreamingMarketData();
      }, 500);
    }
  }
}

export interface MarketData {
  symbol: string,
  market: MarketStreamDataGood[],
}

export interface MarketStreamDataGood {
  symbol: string,
  volumePerUnit: number,
  pricePerUnit: number,
  spread: number,
  purchasePricePerUnit: number,
  sellPricePerUnit: number, 
  quantityAvailable: number,
}

