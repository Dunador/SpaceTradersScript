import * as _ from "lodash";
import { groupBy } from "lodash";
import { SpaceTraders } from "spacetraders-sdk";
import {
  Cargo,
  Marketplace,
  YourShip,
  LocationsResponse,
  MarketplaceResponse,
  AccountResponse,
  User,
  SellResponse,
  PurchaseResponse,
  Ship,
  Location,
  LocationWithMarketplace,
} from "spacetraders-sdk/dist/types";
import { IntraSystemTrader } from "./classes/IntraSystemTrader";
import { LocationScout } from "./classes/LocationScout";
import { generateDisplay, log } from "./monitor/monitor";
import { LoadedShip, Goods } from "./types";
import * as globals from "./utils/globals";
import { MarketUtil } from "./utils/marketUtil";

let token: string = "e4422519-3ffb-4001-be3e-032e34d26b13";
const username: string = "Dunador";
globals.spaceTraders.init(username, token).then(() => {}, async () => {
  newAccount();
});
let intraTraders: IntraSystemTrader[] = [];
let locationScouts: LocationScout[] = [];
const shipsToBuy: Map<string, any> = new Map();

async function main() {
  initialize();
  // MarketUtil.startStreamingMarketData();
  while (true) {
    try {
      try {
        await globals.spaceTraders.getAccount().then((d) => {
          globals.setCredits(d.user.credits);
        }, async () => {
          initialize();
          newAccount();
        });
        await globals.spaceTraders.getShips().then(
          async (d) => {
            if (globals.getAllShips().length !== d.ships.length)
              globals.setAllShips(d.ships.map((x) => { return { ship: x, goodMap: new Map(), system: x.location }}));
            if (_.isEmpty(intraTraders)) {
              for (const ship of d.ships) {
                let trader = new IntraSystemTrader(ship);
                if (ship.location) {
                  trader.system = ship.location.split('-')[0];
                } else {
                  try {
                    trader.system = await (
                      await globals.spaceTraders.getFlightPlan(ship.flightPlanId)
                    ).flightPlan.destination.split('-')[0];
                  } catch (e) {
                    console.log(e);
                  }
                }
                if (ship.manufacturer === "Jackshaw" && d.ships.filter(x => x.manufacturer !== 'Jackshaw').length !== 0) {
                  locationScouts.push(new LocationScout(ship, trader.system));
                  globals.scoutsInSystems.set(trader.system, globals.scoutsInSystems.get(trader.system) + 1 || 1);
                }
                else intraTraders.push(trader);
                globals.setAllShips(globals.getAllShips().map((s) => {
                  return s.ship.id === trader.ship.id ? { ship: trader.ship, system: trader.system, goodMap: s.goodMap } : s;
                }));
              }
            } else {
              for (const ship of d.ships) {
                let updateShip;
                if (ship.manufacturer === "Jackshaw")
                  updateShip = locationScouts.find((scout) => {
                    return scout.ship.id === ship.id;
                  });
                else
                  updateShip = intraTraders.find((cship) => {
                    return cship.ship.id === ship.id;
                  });
                let system: string;
                if (ship.location) {
                  system = ship.location.split('-')[0];
                } else {
                  try {
                    const flight = await globals.spaceTraders.getFlightPlan(
                      ship.flightPlanId
                    );
                    system = flight.flightPlan.destination.split('-')[0];
                  }
                  catch (e) {
                    console.log(e);
                  }
                }

                if (updateShip) {
                  updateShip.system = system;
                  updateShip.ship = ship;
                } else {
                  if (ship.manufacturer === "Jackshaw" && intraTraders.length > 0)
                    locationScouts.push(new LocationScout(ship, system));
                  else intraTraders.push(new IntraSystemTrader(ship, system));
                }
                globals.setAllShips(globals.getAllShips().map((s) => {
                  return s.ship.id === ship.id ? { ship: ship, system: system, goodMap: s.goodMap } : s;
                }));
              }
            }

            return d;
          },
          (e) => { }
        );
        await MarketUtil.updateMarketData();
      } catch (e) {
        console.log(e);
      }

      for (const ship of locationScouts) 
        await ship.scoutLocation();

      for (const cargoShip of intraTraders) {
        await cargoShip.handleTrade();
      }

      await checkPurchaseNewShip();
    } catch (e) {
      console.log(e);
    }
  }
}

async function checkPurchaseNewShip() {
  let availShips: Ship[] = [];
  for (const system of globals.knownSystems) {
    const systemShips = await globals.spaceTraders.viewAvailableShips(system);
    availShips = availShips.concat(systemShips.shipListings);
  }
  
  let creditsToHold = 0;
  // Keep 100 credits per open cargo space
  intraTraders.forEach((ship) => {
    if (ship.ship.manufacturer !== "Jackshaw")
      creditsToHold += ship.ship.maxCargo * 100;
  });
  for (let ship of availShips) {
    for (let purchaseLocation of ship.purchaseLocations) {
      for (let [system, shipsInSystemToBuy] of shipsToBuy) {
        if (
          creditsToHold + purchaseLocation.price <= globals.getCredits() &&
          shipsInSystemToBuy[ship.manufacturer][ship.class] >
          _.filter(globals.getAllShips(), (currShip) => {
            return (
              currShip.ship.manufacturer === ship.manufacturer &&
              currShip.ship.class === ship.class &&
              currShip.system === system
            );
          }).length &&
          purchaseLocation.location.split('-')[0] === system &&
          globals.getAllShips().find(ship => ship.ship.location === purchaseLocation.location)
        ) {
          if (ship.manufacturer === 'Jackshaw' && globals.getAllShips().filter((s) => s.ship.manufacturer !== 'Jackshaw').length * 2 > globals.getAllShips().filter((s) => s.ship.manufacturer === 'Jackshaw').length) {
            try {
              await globals.spaceTraders.purchaseShip(
                purchaseLocation.location,
                ship.type
              );
              globals.addCredits(purchaseLocation.price * -1);
              // Only buy 1 ship per loop, to prevent massive decrease in credits.
              return;
            } catch (e) {
              console.log(e);
            }
          } else if(ship.manufacturer !== 'Jackshaw') {
            try {
              await globals.spaceTraders.purchaseShip(
                purchaseLocation.location,
                ship.type
              );
              globals.addCredits(purchaseLocation.price * -1);
              // Only buy 1 ship per loop, to prevent massive decrease in credits.
              return;
            } catch (e) {
              console.log(e);
            }
          } else {
            continue;
          }
        }
      }
    }
  }
}

async function initialize () {
  globals.knownSystems.forEach(async (system) => {
    
    globals.bestRoutesPerSystem.set(system, []);
    globals.universeMarkets.set(system, []);
    globals.setCredits(0);
    globals.setAllShips([]);
    shipsToBuy.set(system, {
      Gravager: {
        "MK-I": 0,
        "MK-II": 0,
        "MK-III": 0,
      },
      Jackshaw: {
        "MK-I": 11,
        "MK-II": 0,
        "MK-III": 0,
      },
      Electrum: {
        "MK-I": 0,
        "MK-II": 0,
        "MK-III": 0,
        "MK-IV": 0
      },
      Zetra: {
        "MK-I": 0,
        "MK-II": 0,
      },
      Hermes: {
        "MK-I": 0,
        "MK-II": 0,
        "MK-III": 40,
      },
      Tiddalik: {
        "MK-I": 0,
      },
      Zatashi: {
        "MK-I": 0,
        "MK-II": 0,
      }
    });
  });
}

async function newAccount() {
  console.log("IN NEW ACCOUNT");
  token = await globals.spaceTraders.init(username);
  await globals.spaceTraders.takeOutLoan("STARTUP");
  globals.setCredits(200000);
}

main();

setInterval(() => {
  generateDisplay(intraTraders);
}, 15000).unref();
