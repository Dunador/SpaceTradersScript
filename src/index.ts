import * as _ from 'lodash';
import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, Marketplace, YourShip, LocationsResponse, MarketplaceResponse, AccountResponse, User, SellResponse, PurchaseResponse, Ship, Location, LocationWithMarketplace } from 'spacetraders-sdk/dist/types';
import { generateDisplay, log } from './monitor/monitor';
import { LoadedShip, Goods } from './types';

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const spaceTraders = new SpaceTraders();

spaceTraders.init("Dunador", "46bb99f8-afe2-47ed-9f17-623bd9995639");
let currentShips: LoadedShip[] = [];
let currentShip: LoadedShip;
let bestRoutesPerSystem: Map<string, Goods[]> = new Map();
let universeMarkets: Map<string, LocationWithMarketplace[]> = new Map();
let currentUser: User;
const shipsToBuy: Map<string, any> = new Map();

let locationMap: Map<string, Location[]> = new Map();

const knownSystems = ['OE', 'XV'];

async function main() {
    knownSystems.forEach(async (system) => {
        const locations = (await spaceTraders.listLocations(system)).locations;
        locationMap.set(system, locations.filter((loc) => loc.type !== 'WORMHOLE'));
        bestRoutesPerSystem.set(system, []);
        universeMarkets.set(system, []);
        shipsToBuy.set(system, {
            Gravager: {
                "MK-I": 10,
                "MK-II":5,
                "MK-III":50,
            },
            Jackshaw: {
                "MK-I": 10,
                "MK-II":0,
                "MK-III":0,
            },
            Electrum: {
                "MK-I": 0,
                "MK-II":0,
                "MK-III":0,
            },
            Zetra: {
                "MK-I":0,
                "MK-II":0,
            },
            Hermes: {
                "MK-I": 0,
                "MK-II": 0,
                "MK-III": 15,
            }
        });
    });
    while(true) {
        try {
            await spaceTraders.getAccount().then((d) => { 
                currentUser = d.user;
            });
            await spaceTraders.getShips().then(async (d) => {
                if(_.isEmpty(currentShips)) {
                    for (const ship of d.ships) {
                        let addShip: LoadedShip = {ship, cargoCost: 0};
                        if (ship.location) {
                            addShip.system = ship.location.substring(0,2);
                        } else if(ship.flightPlanId){
                            const flight = await spaceTraders.getFlightPlan(ship.flightPlanId);
                            addShip.system = flight.flightPlan.destination.substring(0,2);
                        }
                        currentShips.push(addShip);
                    }
                } else {
                    for (const ship of d.ships) {
                        let updateShip = currentShips.find((cship) => { return cship.ship.id === ship.id});
                        let system: string;
                        if (ship.location) {
                            system = ship.location.substring(0,2);
                        } else {
                            const flight = await spaceTraders.getFlightPlan(ship.flightPlanId);
                            system = flight.flightPlan.destination.substring(0,2);
                        }
                        if (updateShip) {
                            updateShip.ship = ship;
                        } else {
                            currentShips.push({ ship, cargoCost: 0, lastLocation: '', system: system });
                        }
                    }
                }
    
                return d; 
            }, 
            (e) => {});
        } catch (e) {
            console.log(e);
        }
        
        for (const cargoShip of currentShips) {
            currentShip = cargoShip;
            let shipLoc = cargoShip.ship.location;

            if (!_.isEmpty(shipLoc)) {
                await doSomething();
            }
        }
        await checkPurchaseNewShip();
        await delay(1000);
    }
}

async function doSomething() {
    if (currentShip.ship.location && (currentShip.ship.location !== 'OE-XV-91-2' && currentShip.ship.location !== 'XV-OE-2-91')) {
        const stationMarket = await updateMarketData(currentShip.ship.location);
         if (currentShip.ship.manufacturer !== "Jackshaw") {
            await sellGoods(stationMarket);
            await buyGoods(stationMarket);
            await navigate();
        }
    }
}

async function sellGoods(stationMarket: Marketplace[]) {
    if (currentShip.ship.cargo.length > 0) {
        for (const item of currentShip.ship.cargo) {
            if (item.good === "FUEL" && currentShip.ship.location !== 'XV-BN') {
                try {
                    const order = await spaceTraders.sellGood(currentShip.ship.id, "FUEL", item.quantity);
                    currentUser.credits += order.order.total;
                    currentShip.ship = order.ship;
                } catch (e) {
                    console.log(e);
                }
            } else {
                const stationGood = stationMarket.find((good) => { return good.symbol == item.good && good.symbol !== 'FUEL' });
                const systemGoods = bestRoutesPerSystem.get(currentShip.ship.location.substring(0,2));
                const marketData = systemGoods.find(good => good.symbol === item.good);
                if (stationGood && marketData && marketData.lowLoc !== currentShip.ship.location) {
                    let qtyToSell = item.quantity;
                    while(qtyToSell > 0) {
                        try {
                            const order = await spaceTraders.sellGood(currentShip.ship.id, item.good, (qtyToSell > 300 ? 300 : qtyToSell));
                            qtyToSell -= 300;
                            currentShip.ship = order.ship;
                            currentUser.credits += order.order.total;
                        } catch (e) {
                            console.log(e);
                            break;
                        }
                    }
                }
            }
        }
    }
}

async function updateMarketData(location: string) {
    let marketData;
    try {
        marketData = await spaceTraders.getMarketplace(location);
    } catch (e) {
        console.log(e);
    }

    if (marketData) {  

        const systemMarkets = universeMarkets.get(location.substring(0,2));

        let locationMarket = systemMarkets.find((market) => market.symbol === location);
        if (locationMarket)
            locationMarket = marketData.location;
        else
            systemMarkets.push(marketData.location);
        calculateBestRoutes();
        return marketData.location.marketplace;

        // for (const item of marketData.location.marketplace) {
        //     if (item.symbol !== "FUEL") {
        //         const systemGoods = marketGoods.get(currentShip.ship.location.substring(0,2));
        //         let updateItem = systemGoods.find((good) => { return good.symbol === item.symbol});
        //         const updateIndex = systemGoods.indexOf(updateItem);
        //         if (updateItem) {
        //             const systemLocs = locationMap.get(location.substring(0,2));
        //             const lowLoc = systemLocs.find((loc) => { return loc.symbol === updateItem?.lowLoc });
        //             const highLoc = systemLocs.find((loc) => { return loc.symbol === updateItem?.highLoc });
        //             const currLoc = systemLocs.find((loc) => { return loc.symbol === location });
        //             const lowToCurrDist = distance(lowLoc, currLoc) + 1;
        //             const highToCurrDist = distance(highLoc, currLoc) +1;
        //             const currentDist = distance(lowLoc, highLoc) + 1;

        //             // Price drift, but not if only 1 location scouted for good (prices will always be wonky for only 1 location)
        //             if (updateItem.lowPrice > updateItem.highPrice && updateItem.lowLoc !== updateItem.highLoc) {
        //                 const tmp = _.cloneDeep(updateItem);
        //                 updateItem.highPrice = tmp.lowPrice;
        //                 updateItem.highLoc = tmp.lowLoc;
        //                 updateItem.lowPrice = tmp.highPrice;
        //                 updateItem.lowLoc = tmp.highLoc;
        //             }
                    
        //             let newUpdateItem = _.cloneDeep(updateItem);

        //             const currentCDV = ((updateItem.highPrice - updateItem.lowPrice) / (currentDist === 0 ? 1 : currentDist)) / updateItem.volume;
        //             const newLowCDV = ((updateItem.highPrice - (item.pricePerUnit + (item as any)['spread'])) / (highToCurrDist === 0 ? 1 : highToCurrDist)) / updateItem.volume;
        //             const newHighCDV = (((item.pricePerUnit - (item as any)['spread']) - updateItem.lowPrice) / (lowToCurrDist === 0 ? 1 : lowToCurrDist)) / updateItem.volume;    
                    
        //             if (newLowCDV > currentCDV || updateItem.lowLoc === currentShip.ship.location) {
        //                 newUpdateItem.lowLoc = currLoc.symbol;
        //                 newUpdateItem.lowPrice = item.pricePerUnit + (item as any)['spread'];
        //             }

        //             if (newHighCDV > currentCDV || updateItem.highLoc === currentShip.ship.location) {
        //                 newUpdateItem.highLoc = currLoc.symbol;
        //                 newUpdateItem.highPrice = item.pricePerUnit  - (item as any)['spread'];
        //             }

        //             if (newUpdateItem.lowLoc === newUpdateItem.highLoc) {
        //                 if (newLowCDV >= newHighCDV) {
        //                     newUpdateItem.highPrice = updateItem.highPrice;
        //                     newUpdateItem.highLoc = updateItem.highLoc;
        //                 } else {
        //                     newUpdateItem.lowPrice = updateItem.lowPrice;
        //                     newUpdateItem.lowLoc = updateItem.lowLoc;
        //                 }
        //             }

        //             const newDist = distance(systemLocs.find(loc => loc.symbol === newUpdateItem.highLoc), systemLocs.find(loc => loc.symbol === newUpdateItem.lowLoc));
        //             newUpdateItem.cdv = (newUpdateItem.highPrice - newUpdateItem.lowPrice) / (newDist === 0 ? 1 : newDist) / newUpdateItem.volume;
                    
        //             systemGoods[updateIndex] = newUpdateItem;
        //         } else {
        //             systemGoods.push({
        //             symbol: item.symbol,
        //             lowPrice: item.pricePerUnit + (item as any)['spread'],
        //             lowLoc: location,
        //             highPrice: item.pricePerUnit - (item as any)['spread'],
        //             highLoc: location, 
        //             volume: item.volumePerUnit,
        //             cdv: 0,
        //             });
        //         }
        //     }
        // }
        // // console.log(marketGoods);
        // return marketData.location.marketplace;
    } else {
        return [];
    }
}

function calculateBestRoutes() {
    
    for (const [system, markets] of universeMarkets) {
        let priceMap: Goods[] = [];
        for (const market of markets) {
            for (const goods of market.marketplace) {
                if (goods.symbol !== 'FUEL') {
                    let item = priceMap.find(good => good.symbol === goods.symbol);
                    let itemIndex = priceMap.indexOf(item);
                    if (item) {
                        const lowMarket = markets.find(mar => mar.symbol === item.lowLoc);
                        const highMarket = markets.find(mar => mar.symbol === item.highLoc);
                        const lowToCurrDist = distance(lowMarket, market);
                        const highToCurrDist = distance(highMarket, market);

                        const currentCDV = item.cdv;
                        const newLowCDV = (item.highPrice - (goods as any)['purchasePricePerUnit']) / highToCurrDist / goods.volumePerUnit;
                        const newHighCDV = ((goods as any)['sellPricePerUnit'] - item.lowPrice) / lowToCurrDist / goods.volumePerUnit;  
                        
                        if (newLowCDV > currentCDV && newLowCDV !== Infinity) {
                            item.lowPrice = (goods as any)['purchasePricePerUnit'];
                            item.lowLoc = market.symbol;
                            item.cdv = newLowCDV;
                        }

                        if (newHighCDV > currentCDV) {
                            item.highPrice = (goods as any)['sellPricePerUnit'];
                            item.highLoc = market.symbol;
                            item.cdv = newHighCDV;
                        }

                    priceMap[itemIndex] = item;

                    } else {
                        priceMap.push({
                            symbol: goods.symbol, 
                            lowPrice: (goods as any)['purchasePricePerUnit'],
                            highPrice: (goods as any)['sellPricePerUnit'],
                            lowLoc: market.symbol,
                            highLoc: market.symbol,
                            volume: goods.volumePerUnit,
                            cdv: -100,
                        });
                    }
                }
            }
        }
        bestRoutesPerSystem.set(system, priceMap);
    }
}

async function buyGoods(stationMarket: Marketplace[]) {

    let goodToBuy: Goods;
    let goodMarketData;
    const systemGoods = bestRoutesPerSystem.get(currentShip.ship.location.substring(0,2));
    let orderedMarket = _.orderBy(systemGoods, ['cdv'], ['desc']);
    const creditsToMaintain = 20000;

    if (orderedMarket.length > 0 && currentShip.ship.location === orderedMarket[0].lowLoc) {
        goodToBuy = orderedMarket[0];
        goodMarketData = stationMarket.find(good => good.symbol === goodToBuy.symbol)
    } else if ((goodToBuy = orderedMarket.find(good => good.lowLoc === currentShip.ship.location && good.highLoc === orderedMarket[0].lowLoc && good.cdv > 0)) !== undefined) {
        goodMarketData = stationMarket.find(good => good.symbol === goodToBuy.symbol);
    } else {
        goodToBuy = orderedMarket.find(good => good.lowLoc === currentShip.ship.location && good.cdv > 0);
        if (goodToBuy) {
            goodMarketData = stationMarket.find(good => good.symbol === goodToBuy.symbol);
        }
    }
    if (goodToBuy && goodMarketData) {
        const routeFuel = calculateFuelNeededForGood(goodToBuy.symbol).fuelNeeded;

        if (currentShip.ship.spaceAvailable > routeFuel && goodToBuy.cdv > 0 && (currentUser.credits - creditsToMaintain - (routeFuel * 2)) > goodToBuy.lowPrice) {
            let quantityToBuy = Math.floor((currentShip.ship.spaceAvailable - routeFuel) / goodToBuy.volume);

            if (quantityToBuy >= goodMarketData.quantityAvailable) {
                quantityToBuy = goodMarketData.quantityAvailable - 1;
            }
            if ((quantityToBuy * goodMarketData.pricePerUnit) >= currentUser.credits) {
                quantityToBuy = Math.floor((currentUser.credits - creditsToMaintain) / goodMarketData.pricePerUnit);
            }

            while (quantityToBuy > 0) {
                currentShip.ship.spaceAvailable -= quantityToBuy * goodToBuy.volume;
                try {
                    const order = await spaceTraders.purchaseGood(currentShip.ship.id, goodToBuy.symbol, (quantityToBuy > 300 ? 300 : quantityToBuy));
                    quantityToBuy -= 300;
                    currentShip.ship = order.ship;
                    currentUser.credits -= order.order.total;
                } catch (e) {
                    console.log(e);
                    break;
                }
            }
        }
    }
    
}

async function navigate() {
    const targetData = calculateFuelNeededForGood();
    const targetDest = targetData.targetDest;
    const fuelNeeded = targetData.fuelNeeded;
    let goodToSell: Cargo = currentShip.ship.cargo.find((good) => { return good.good !== "FUEL" });
    if (!_.isEmpty(goodToSell)) {
        const systemGoods = bestRoutesPerSystem.get(currentShip.ship.location.substring(0,2));
        let goodToSellData: Goods = systemGoods.find((marketGood) => { return marketGood.symbol === goodToSell.good });
        while (fuelNeeded > currentShip.ship.spaceAvailable) {
            try {
                const o = await spaceTraders.sellGood(currentShip.ship.id, goodToSell.good, 1);
                currentUser.credits += o.order.total;
                currentShip.ship = o.ship;
            } catch (e) {
                try {
                    await spaceTraders.jettisonGoods(currentShip.ship.id, goodToSell.good, 1);
                    currentShip.ship.spaceAvailable += goodToSellData.volume;
                } catch (e) {
                    goodToSell = currentShip.ship.cargo.find((good) => { return good.good !== "FUEL" && good.good !== goodToSell.good});
                    if (goodToSell) {
                        goodToSellData = systemGoods.find((marketGood) => { return marketGood.symbol === goodToSell.good });
                    } else {
                        // stuck ship
                        return;
                    }
                    
                }
            }
        }
    }
    if (currentShip.ship.location !== 'XV-BN') {
        try {
            let tmp = await spaceTraders.purchaseGood(currentShip.ship.id, "FUEL", fuelNeeded);
            currentUser.credits -= tmp.order.total;
            currentShip.ship = tmp.ship;
        } catch (e) {
            console.log(e);
        }
    }

    try {
        await spaceTraders.createFlightPlan(currentShip.ship.id, targetDest).then(() => {
            currentShip.lastLocation = currentShip.ship.location;
            currentShip.ship.location = null;
        });
    } catch (e) {
        console.log(e);
    }
}

function backupNavigation(systemLocs: Location[]) {
    const systemGoods = bestRoutesPerSystem.get(currentShip.ship.location.substring(0,2));
    let orderedMarket = _.orderBy(systemGoods, ['cdv'], ['desc']);
    let targetDest = systemLocs.find(loc => loc.symbol === orderedMarket[0].lowLoc && loc.symbol !== currentShip.ship.location);
    if (!targetDest) {
        targetDest = systemLocs.find(loc => loc.symbol !== currentShip.ship.location);
    }
    const currentLoc = systemLocs.find(loc => loc.symbol === currentShip.ship.location);
    const tripDist = distance(targetDest, currentLoc);

    let penalty = 0;
    if (currentLoc.type.toLowerCase() === "planet") {
        penalty += 2;
        penalty += currentShip.ship.class === "MK-II" ? 1 : 0;
        penalty += currentShip.ship.class === "MK-III" ? 2 : 0;
    }
    let fuelNeeded = Math.round(tripDist / 4) + penalty + 1;
    if (targetDest.symbol === 'XV-BN') 
        fuelNeeded = fuelNeeded * 2;    
    return {targetDest: targetDest.symbol, fuelNeeded};
}

async function checkPurchaseNewShip() {
    const availShips = await spaceTraders.viewAvailableShips();
    let creditsToHold = 0;
    // Keep 100 credits per open cargo space
    currentShips.forEach((ship) => {
        if (ship.ship.manufacturer !== 'Jackshaw')
            creditsToHold += ship.ship.maxCargo * 100
    });
    for (let ship of availShips.ships) {
        for (let purchaseLocation of ship.purchaseLocations) {
            for (let [system, shipsInSystemToBuy] of shipsToBuy) {
                if (
                    (creditsToHold + purchaseLocation.price) <= currentUser.credits &&
                    shipsInSystemToBuy[ship.manufacturer][ship.class] > _.filter(currentShips, (currShip) => {
                        return (currShip.ship.manufacturer === ship.manufacturer && currShip.ship.class === ship.class && currShip.system === system);
                    }).length &&
                    purchaseLocation.location.substring(0,2) === system
                ) {
                    try {
                        await spaceTraders.purchaseShip(purchaseLocation.location, ship.type);
                        currentUser.credits -= purchaseLocation.price;
                    } catch (e) {
                        console.log(e);
                    }
                }
            }
        }
    }
}

function calculateFuelNeededForGood(good?: string) {

    const systemLocations = locationMap.get((currentShip.ship.location).substring(0,2));
    // Need both conditions.  When determing distance for buying purposes, the cargo will always be empty.  When determining navigation, cargo should never be empty
    if (currentShip.ship.cargo.length > 0 || !_.isEmpty(good)) {
        let goodToShip: string;
        if (good) {
            goodToShip = good;
        } else {
            goodToShip = currentShip.ship.cargo.find((good) => { return (good.good !== "FUEL") })?.good;
        }
        if (goodToShip) {
            const systemGoods = bestRoutesPerSystem.get(currentShip.ship.location.substring(0,2));
            const goodMarketData = systemGoods.find((good) => { return good.symbol === goodToShip});
            if (goodMarketData && goodMarketData.highLoc) {
                const targetDest = systemLocations.find((loc) => { return loc.symbol === goodMarketData.highLoc && loc.symbol});
                const currentLoc = systemLocations.find((loc) => { return loc.symbol === currentShip.ship.location});
                if (targetDest && currentLoc && (targetDest.symbol !== currentLoc.symbol)) {
                    const distanceToMarket = distance(targetDest, currentLoc);
                    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
                    const mk2ShipPenalty = currentShip.ship.class === "MK-II" ? 1 : 0;
                    const mk3ShipPenalty = currentShip.ship.class === "MK-III" ? 2 : 0;
                    let fuelNeeded = Math.round(distanceToMarket / 4) + penalty + mk2ShipPenalty + mk3ShipPenalty + 1;
                    if (targetDest.symbol === 'XV-BN')
                        fuelNeeded = fuelNeeded * 2;
                    return {targetDest: targetDest.symbol, fuelNeeded};
                } else {
                    return backupNavigation(systemLocations);
                }
            } else {
                return backupNavigation(systemLocations);
            }
        } else {
            return backupNavigation(systemLocations);
        }
    } else {
        return backupNavigation(systemLocations);
    }
}

function distance(loc1: Location, loc2: Location) {
    const xdiff = Math.pow(loc2.x - loc1.x, 2);
    const ydiff = Math.pow(loc2.y - loc1.y, 2);
    return Math.ceil(Math.sqrt(xdiff+ydiff));
}

main();

setInterval(() => {
    generateDisplay(currentShips, currentUser);
}, 5000).unref();

