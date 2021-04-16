import { YourShip } from "spacetraders-sdk/dist/types";

export interface LoadedShip {
  ship: YourShip,
  cargoCost?: number,
  lastLocation?: string,
  system?: string,
}