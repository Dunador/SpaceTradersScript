import { Marketplace } from "spacetraders-sdk/dist/types";

export interface PurchaseGoods {
  good: Marketplace,
  gainPerQty: number,
  fuelToMarket: number,
}