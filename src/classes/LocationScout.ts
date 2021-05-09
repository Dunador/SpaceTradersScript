import { YourShip } from "spacetraders-sdk/dist/types";
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
    if(globals.getAllShips().filter((ship) => ship.location === this.ship.location && ship.manufacturer === 'Jackshaw' && this.ship.location !== undefined).length > 1) {
      const newLoc = globals.locationMap.get(this.ship.location.substring(0,2)).find((loc) => !globals.getAllShips().filter(ship => ship.manufacturer === 'Jackshaw').map(x => x.location).includes(loc.symbol));
      await globals.spaceTraders.purchaseGood(this.ship.id, 'FUEL', MarketUtil.getFuelNeeded(this.ship, globals.locationMap.get(this.ship.location.substring(0,2)).find(loc => loc.symbol === this.ship.location), newLoc));
      await globals.spaceTraders.createFlightPlan(this.ship.id, newLoc.symbol);
      let allShips = globals.getAllShips();
      const updateIndex = allShips.indexOf(this.ship);
      this.ship.location = undefined;
      allShips[updateIndex] = this.ship;
      globals.setAllShips(allShips);
      
    }
  }
}
