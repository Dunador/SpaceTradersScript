import { Location, LocationWithMarketplace, Marketplace, YourShip } from "spacetraders-sdk/dist/types";
import * as globals from "./globals";
import * as _ from "lodash";
import { IntraSystemTrader } from "../classes/IntraSystemTrader";
import { Goods } from "../types";
import { LocationScout } from "../classes/LocationScout";
import WebSocket from 'isomorphic-ws';
import { Console } from "node:console";

const noFuelLocations = ["XV-BN"];

export interface FuelTarget {
  targetDest: string;
  fuelNeeded: number;
}

export interface MarketWithLocationSymbol extends LocationWithMarketplace, Location {
  symbol: string;
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
        const systemGoods = globals.getAllShips().find(x => x.ship.id === ship.id).goodMap.get(ship.location.substring(0,2));
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
            const fuelNeeded = this.getFuelNeeded(ship, currentLoc, targetDest);
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
    const systemGoods = globals.getAllShips().find(x => x.ship.id === ship.id).goodMap.get(ship.location.substring(0,2));
    let orderedMarket = _.orderBy(systemGoods, ["cdv"], ["desc"]);
    let targetDest = systemLocs.find(
      (loc) =>
        loc.symbol === orderedMarket[0].lowLoc && loc.symbol !== ship.location
    );
    if (!targetDest) {
      targetDest = systemLocs.find((loc) => loc.symbol !== ship.location);
    }
    const currentLoc = systemLocs.find((loc) => loc.symbol === ship.location);

    const fuelNeeded = this.getFuelNeeded(ship, currentLoc, targetDest);

    return { targetDest: targetDest.symbol, fuelNeeded };
  }

  public static distance(loc1: Location, loc2: Location) {
    const xdiff = Math.pow(loc2.x - loc1.x, 2);
    const ydiff = Math.pow(loc2.y - loc1.y, 2);
    return Math.ceil(Math.sqrt(xdiff + ydiff));
  }

  public static async updateMarketData() {
    for (let [system, markets] of globals.universeMarkets) {
      let marketData: MarketWithLocationSymbol[] = [];
      const uniqueLocs = [
        ...new Set(
          globals.getAllShips()
            .filter(
              (ship) =>
              ship.ship.location !== undefined && ship.ship.location.substring(0,2) === system
            )
            .map((ship) => ship.ship.location)
        ),
      ];
      for (let loc of uniqueLocs) {
        await Promise.all([globals.spaceTraders.getMarketplace(loc), globals.spaceTraders.getLocation(loc)]).then((data) => {
          marketData.push({ 
            symbol: loc, 
            marketplace: data[0]['marketplace'],  
            name: data[1].location.name,
            type: data[1].location.type,
            x: data[1].location.x,
            y: data[1].location.y,
          });
        });
      }

      for (let market of markets) {
        if (!marketData.find(mar => mar.symbol === market.symbol)) {
            marketData.push(market);
        }
      }

      globals.universeMarkets.set(system, marketData);
    }

    this.calculateBestIntraSystemRoutes();
    // this.calculateBestInterSystemRoutes();
  }

  public static getFuelNeeded(ship: YourShip, currentLoc: Location, destination: Location) {
    const distance = this.distance(currentLoc, destination);
    
    let penalty = 0;
    if (currentLoc.type.toLowerCase() === "planet") {
      penalty += 2;
      penalty += ship.class === "MK-II" ? 1 : 0;
      penalty += ship.class === "MK-III" ? 2 : 0;
    }
    let fuelNeeded = Math.round(distance / 7.5) + penalty + 1;
    if (noFuelLocations.includes(destination.symbol)) fuelNeeded = fuelNeeded * 2;
    fuelNeeded -=
      ship.cargo.find((item) => item.good === "FUEL")?.quantity || 0;
    if (fuelNeeded < 0) fuelNeeded = 0;

    return fuelNeeded;
  }

  private static calculateBestIntraSystemRoutes() {
    globals.getAllShips().forEach((ship) => {
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
                (((item.highPrice - goods.purchasePricePerUnit) * (ship.ship.maxCargo - (this.getFuelNeeded(ship.ship, market, highMarket)))) - 
                (this.getFuelNeeded(ship.ship, market, highMarket) * market.marketplace.find(good => good.symbol === 'FUEL').purchasePricePerUnit)) /
                this.getFlightTime(lowToCurrDist, ship.ship.speed) /
                goods.volumePerUnit;
              const newHighCDV =
                (((goods.purchasePricePerUnit - item.lowPrice) * (ship.ship.maxCargo - (this.getFuelNeeded(ship.ship, market, lowMarket)))) - 
                (this.getFuelNeeded(ship.ship, market, lowMarket) * market.marketplace.find(good => good.symbol === 'FUEL').purchasePricePerUnit)) /
                this.getFlightTime(highToCurrDist, ship.ship.speed) /
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
                (((item.highPrice - item.lowPrice) * (ship.ship.maxCargo - 
                  this.getFuelNeeded(ship.ship, markets.find((loc) => loc.symbol === item.highLoc), markets.find((loc) => loc.symbol === item.lowLoc)))) - 
                  (this.getFuelNeeded(ship.ship, markets.find((loc) => loc.symbol === item.highLoc), markets.find((loc) => loc.symbol === item.lowLoc)) *  market.marketplace.find(good => good.symbol === 'FUEL').purchasePricePerUnit)) /
                this.getFlightTime((newDist === 0 ? 1 : newDist), ship.ship.speed) /
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
        ship.goodMap.set(system, priceMap);
      }
    });
  }

  private static calculateBestInterSystemRoutes() {
    let markets: MarketWithLocationSymbol[] = [];
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

  private static getFlightTime(distance: number, speed: number) {
    return Math.round(distance * (3 / speed)) + 30;
  }
}