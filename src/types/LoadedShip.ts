import { YourShip } from "spacetraders-sdk/dist/types";
import { Goods } from ".";

export interface LoadedShip {
  ship: YourShip,
  system?: string,
  goodMap?:  Map<string, Goods[]>,
}