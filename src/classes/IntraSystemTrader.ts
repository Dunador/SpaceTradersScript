import { SpaceTraders } from "spacetraders-sdk";
import { Cargo, Marketplace, YourShip } from "spacetraders-sdk/dist/types";
import { Goods, LoadedShip } from "../types";
import * as globals from "../utils/globals";
import { MarketUtil } from "../utils/marketUtil";
import * as _ from "lodash";

export class IntraSystemTrader implements LoadedShip {
  ship: YourShip;
  system: string;

  constructor(ship: YourShip, system?: string) {
    this.ship = ship;
    this.system = system || "";
  }

  public async handleTrade() {
    if (this.ship.location) {
      const stationMarket = globals.universeMarkets
        .get(this.ship.location.substring(0, 2))
        .find((mar) => mar.symbol === this.ship.location).marketplace;
      if (stationMarket) {
        await this.sellGoods(stationMarket);
        await this.buyGoods(stationMarket);
        await this.navigate();
      }
    }
  }

  private async sellGoods(stationMarket: Marketplace[]) {
    if (this.ship.cargo.length > 0) {
      for (const item of this.ship.cargo) {
        const stationGood = stationMarket.find((good) => {
          return good.symbol == item.good;
        });
        const systemGoods = globals.bestRoutesPerSystem.get(
          this.ship.location.substring(0, 2)
        );
        const marketData = systemGoods.find(
          (good) => good.symbol === item.good
        );
        if (
          stationGood &&
          marketData &&
          marketData.lowLoc !== this.ship.location
        ) {
          let qtyToSell = item.quantity;
          while (qtyToSell > 0) {
            try {
              const order = await globals.spaceTraders.sellGood(
                this.ship.id,
                item.good,
                qtyToSell > 500 ? 500 : qtyToSell
              );
              qtyToSell -= 500;
              this.ship = order.ship;
              globals.addCredits(order.order.total);
            } catch (e) {
              console.log(e);
              break;
            }
          } 
        }
      }
    }
  }

  private async buyGoods(stationMarket: Marketplace[]) {
    let goodToBuy: Goods;
    let goodMarketData: Marketplace;
    const systemGoods = globals.bestRoutesPerSystem.get(
      this.ship.location.substring(0, 2)
    );
    let orderedMarket = _.orderBy(systemGoods, ["cdv"], ["desc"]);
    const creditsToMaintain = globals.getCreditsToMaintain();

    if (
      orderedMarket.length > 0 &&
      this.ship.location === orderedMarket[0].lowLoc
    ) {
      goodToBuy = orderedMarket[0];
      goodMarketData = stationMarket.find(
        (good) => good.symbol === goodToBuy.symbol
      );
    } else if (
      (goodToBuy = orderedMarket.find(
        (good) =>
          good.lowLoc === this.ship.location &&
          good.highLoc === orderedMarket[0].lowLoc &&
          good.cdv > 0
      )) !== undefined
    ) {
      goodMarketData = stationMarket.find(
        (good) => good.symbol === goodToBuy.symbol
      );
    } else {
      const currMarket = globals.universeMarkets
        .get(this.system)
        .find((mar) => mar.symbol === this.ship.location);
      const targetMarket = globals.universeMarkets
        .get(this.system)
        .find((mar) => mar.symbol === orderedMarket[0].lowLoc);
      let bestGood: Goods,
        bestGoodData: Marketplace,
        bestGoodCDV = -100;
      for (const item of currMarket.marketplace) {
        let targetItem = targetMarket.marketplace.find(
          (x) => item.symbol === x.symbol
        );
        if (targetItem) {
          let itemCDV =
            (targetItem.sellPricePerUnit - item.purchasePricePerUnit) /
            item.volumePerUnit;
          if (itemCDV > bestGoodCDV) {
            bestGoodData = item;
            bestGood = {
              lowLoc: currMarket.symbol,
              highLoc: targetMarket.symbol,
              lowPrice: item.purchasePricePerUnit,
              highPrice: targetItem.sellPricePerUnit,
              volume: item.volumePerUnit,
              cdv: itemCDV,
              symbol: item.symbol,
            };
            bestGoodCDV = itemCDV;
          }
        }
      }
      goodToBuy = bestGood;
      goodMarketData = bestGoodData;
    }
    if (goodToBuy && goodMarketData) {
      const routeFuel = MarketUtil.calculateFuelNeededForGood(
        this.ship,
        goodToBuy.symbol
      ).fuelNeeded;

      if (
        this.ship.spaceAvailable > routeFuel &&
        goodToBuy.cdv > 0 &&
        globals.getCredits() - creditsToMaintain - (routeFuel * 15) >
          goodToBuy.lowPrice
      ) {
        let quantityToBuy = Math.floor(
          (this.ship.spaceAvailable - routeFuel) / goodToBuy.volume
        );

        if (quantityToBuy >= goodMarketData.quantityAvailable) {
          quantityToBuy = goodMarketData.quantityAvailable - 1;
        }
        if (
          quantityToBuy * goodMarketData.pricePerUnit >=
          globals.getCredits()
        ) {
          quantityToBuy = Math.floor(
            (globals.getCredits() - creditsToMaintain) /
              goodMarketData.pricePerUnit
          );
        }

        while (quantityToBuy > 0) {
          try {
            const order = await globals.spaceTraders.purchaseGood(
              this.ship.id,
              goodToBuy.symbol,
              quantityToBuy > 500 ? 500 : quantityToBuy
            );
            quantityToBuy -= 500;
            this.ship = order.ship;
            globals.addCredits(order.order.total * -1);
          } catch (e) {
            console.log(
              "Route Fuel: " +
                routeFuel +
                " | Ship Space: " +
                this.ship.spaceAvailable
            );
            console.log(e);
            break;
          }
        }
      }
    }
  }

  async navigate() {
    const targetData = MarketUtil.calculateFuelNeededForGood(this.ship);
    const targetDest = targetData.targetDest;
    const fuelNeeded = targetData.fuelNeeded;
    let goodToSell: Cargo;
    if (this.ship.cargo.length > 1) 
      goodToSell = this.ship.cargo.find((good) => {
        return good.good !== "FUEL";
      });
    else
      goodToSell = this.ship.cargo[0];
    if (!_.isEmpty(goodToSell)) {
      const systemGoods = globals.bestRoutesPerSystem.get(
        this.ship.location.substring(0, 2)
      );
      let goodToSellData: Goods = systemGoods.find((marketGood) => {
        return marketGood.symbol === goodToSell.good;
      });
      while (fuelNeeded > this.ship.spaceAvailable) {
        try {
          const o = await globals.spaceTraders.sellGood(
            this.ship.id,
            goodToSell.good,
            10
          );
          globals.addCredits(o.order.total);
          this.ship = o.ship;
        } catch (e) {
          try {
            await globals.spaceTraders.jettisonGoods(
              this.ship.id,
              goodToSell.good,
              10
            );
            this.ship.spaceAvailable += goodToSellData.volume * 10;
          } catch (e) {
            goodToSell = this.ship.cargo.find((good) => {
              return good.good !== "FUEL" && good.good !== goodToSell.good;
            });
            if (goodToSell) {
              goodToSellData = systemGoods.find((marketGood) => {
                return marketGood.symbol === goodToSell.good;
              });
            } else {
              // stuck ship
              return;
            }
          }
        }
      }
    }
    if (fuelNeeded > 0) {
      try {
        let tmp = await globals.spaceTraders.purchaseGood(
          this.ship.id,
          "FUEL",
          fuelNeeded
        );
        globals.addCredits(tmp.order.total * -1);
        this.ship = tmp.ship;
      } catch (e) {
      }
    }

    try {
      await globals.spaceTraders
        .createFlightPlan(this.ship.id, targetDest)
        .then(() => {
          this.ship.location = null;
        });
    } catch (e) {
    }
  }
}
