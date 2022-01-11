import { Location, YourShip } from "spacetraders-sdk/dist/types";
import { LoadedShip } from "../types";
import * as globals from '../utils/globals';
import { MarketUtil } from "../utils/marketUtil";

export class LocationScout implements LoadedShip {
  ship: YourShip;
  system: string;

  constructor(s: YourShip, sys: string) {
    this.ship = s;
    this.system = sys;
  }

  async scoutLocation() {
    await this.getSystemLocations();
    if(globals.getAllShips().filter((ship) => ship.ship.location === this.ship.location && ship.ship.manufacturer === 'Jackshaw').length > 1 && this.ship.location !== undefined) {
      const newLoc = globals.locationMap.get(this.system).find((loc) => !globals.getAllShips().filter(ship => ship.ship.manufacturer === 'Jackshaw').map(x => x.ship.location).includes(loc.symbol));
      // console.log(newLoc);
      if (newLoc) {
        try {
        await globals.spaceTraders.purchaseGood(this.ship.id, 'FUEL', MarketUtil.getFuelNeeded(this.ship, globals.locationMap.get(this.system).find(loc => loc.symbol === this.ship.location), newLoc));
        await globals.spaceTraders.createFlightPlan(this.ship.id, newLoc.symbol);
        this.updateAllShips();
        } catch (e) {}
      } else {
        let warpGate = globals.locationMap.get(this.system).filter((loc) => loc.type === 'WORMHOLE');
        let targetWarpGate: Location;
        if (warpGate.length > 1) {
          targetWarpGate = warpGate.reduce((prev, curr) => {
            return globals.scoutsInSystems.get(prev.symbol.split('-')[2]) < globals.scoutsInSystems.get(curr.symbol.split('-')[2]) ? prev : curr;
          });
        } else {
          targetWarpGate = warpGate[0];
        }
        if (!globals.locationMap.get(targetWarpGate.symbol.split('-')[2]) || globals.scoutsInSystems.get(targetWarpGate.symbol.split('-')[2]) <= globals.locationMap.get(targetWarpGate.symbol.split('-')[2]).length) {
          if (this.ship.location === targetWarpGate.symbol) {
            try {
              await globals.spaceTraders.warpShip(this.ship.id);
              globals.scoutsInSystems.set(this.system, globals.scoutsInSystems.get(this.system) - 1);
              this.system = targetWarpGate.symbol.split('-')[2];
              this.updateAllShips();
              globals.scoutsInSystems.set(this.system, globals.scoutsInSystems.get(this.system) + 1 || 1);
            } catch (e) {}
          } else {
            try {
            await globals.spaceTraders.purchaseGood(this.ship.id, 'FUEL', MarketUtil.getFuelNeeded(this.ship, globals.locationMap.get(this.system).find((loc) => loc.symbol === this.ship.location), targetWarpGate));
            await globals.spaceTraders.createFlightPlan(this.ship.id, targetWarpGate.symbol);
            this.updateAllShips();
            } catch (e) {}
          }
        }
      }
    }
  }

  async getSystemLocations() {
    if(!globals.locationMap.get(this.system)) {
      const locations = (await globals.spaceTraders.listLocations(this.system))
        .locations;
      globals.locationMap.set(
        this.system,
        locations
      );
      const connectingSystems = locations.filter((loc) => loc.type === 'WORMHOLE');
      for (const warp of connectingSystems) {
        const connectingSystem = warp.symbol.split('-')[2];
        if (!globals.knownSystems.includes(connectingSystem))
          globals.knownSystems.push(connectingSystem);
      }
    }
  }

  private updateAllShips() {
    let allShips = globals.getAllShips();
    const updateIndex = allShips.indexOf({ ship: this.ship });
    this.ship.location = undefined;
    allShips[updateIndex] = { ship: this.ship, system: this.system};
    globals.setAllShips(allShips);
  }
}
