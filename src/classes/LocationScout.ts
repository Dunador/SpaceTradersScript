import { YourShip } from "spacetraders-sdk/dist/types";
import { LoadedShip } from "../types";

export class LocationScout implements LoadedShip {
  ship: YourShip;
  system: string;

  constructor(s: YourShip, sys: string) {
    this.ship = s;
    this.system = sys;
  }
}
