import * as _ from 'lodash';
import { update } from 'lodash';
import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, Marketplace, YourShip, LocationsResponse, MarketplaceResponse, AccountResponse, User, SellResponse, PurchaseResponse, Ship, Location } from 'spacetraders-sdk/dist/types';
import { generateDisplay, log } from './monitor/monitor';

export interface LoadedShip {
    ship: YourShip,
    cargoCost?: number,
    lastLocation?: string,
}

export interface Goods {
    symbol: string,
    highPrice: number,
    lowPrice: number,
    highLoc: string,
    lowLoc: string,
    volume: number,
    cdv: number,
}

export interface PurchaseGoods {
    good: Marketplace,
    gainPerQty: number,
    fuelToMarket: number,
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const spaceTraders = new SpaceTraders();

spaceTraders.init("Dunador", "a87a8989-e1ca-4d05-9d63-c8705710b1c8");
let currentShips: LoadedShip[] = [];
let currentShip: LoadedShip;
let marketGoods: Goods[] = [];
let currentUser: User;
const shipsToBuy: any = {
    Gravager: {
        "MK-I": 10,
        "MK-II":5,
        "MK-III":20,
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
        "MK-III": 0,
    }
};

let locationMap: Map<string, Location[]> = new Map();

const knownSystems = ['OE', 'XV'];

async function main() {
    knownSystems.forEach(async (system) => {
        const locations = (await spaceTraders.listLocations(system)).locations;
        locationMap.set(system, locations);
    });
    while(true) {
        try {
            await spaceTraders.getAccount().then((d) => { 
                currentUser = d.user;
                if(_.isEmpty(currentShips)) {
                    for (const ship of d.user.ships) {
                        let addShip: LoadedShip = {ship, cargoCost: 0};
                        currentShips.push(addShip);
                    }
                } else {
                    for (const ship of d.user.ships) {
                        let updateShip = currentShips.find((cship) => { return cship.ship.id === ship.id});
                        if (updateShip) {
                            updateShip.ship = ship;
                        } else {
                            currentShips.push({ ship, cargoCost: 0, lastLocation: '' });
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
            if (item.good === "FUEL") {
                try {
                    const order = await spaceTraders.sellGood(currentShip.ship.id, "FUEL", item.quantity);
                    currentShip.ship = order.ship;
                } catch (e) {
                    console.log(e);
                }
            } else {
                const stationGood = stationMarket.find((good) => { return good.symbol == item.good });
                if (stationGood) {
                    try {
                        const order = await spaceTraders.sellGood(currentShip.ship.id, item.good, item.quantity);
                        currentShip.ship = order.ship;
                        currentUser.credits = order.credits;
                    } catch (e) {
                        console.log(e);
                        continue;
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
        for (const item of marketData.location.marketplace) {
            if (item.symbol !== "FUEL") {
                let updateItem = marketGoods.find((good) => { return good.symbol === item.symbol});
                const updateIndex = marketGoods.indexOf(updateItem);
                if (updateItem) {
                    const systemLocs = locationMap.get(location.substring(0,2));
                    const lowLoc = systemLocs.find((loc) => { return loc.symbol === updateItem?.lowLoc });
                    const highLoc = systemLocs.find((loc) => { return loc.symbol === updateItem?.highLoc });
                    const currLoc = systemLocs.find((loc) => { return loc.symbol === location });
                    const lowToCurrDist = distance(lowLoc, currLoc) + 1;
                    const highToCurrDist = distance(highLoc, currLoc) +1;
                    const currentDist = distance(lowLoc, highLoc) + 1;

                    // Price drift, but not if only 1 location scouted for good (prices will always be wonky for only 1 location)
                    if (updateItem.lowPrice > updateItem.highPrice && updateItem.lowLoc !== updateItem.highLoc) {
                        const tmp = _.cloneDeep(updateItem);
                        updateItem.highPrice = tmp.lowPrice;
                        updateItem.highLoc = tmp.lowLoc;
                        updateItem.lowPrice = tmp.highPrice;
                        updateItem.lowLoc = tmp.highLoc;
                    }
                    
                    let newUpdateItem = _.cloneDeep(updateItem);

                    const currentCDV = ((updateItem.highPrice - updateItem.lowPrice) / (currentDist === 0 ? 1 : currentDist)) / updateItem.volume;
                    const newLowCDV = ((updateItem.highPrice - (item.pricePerUnit + (item as any)['spread'])) / (highToCurrDist === 0 ? 1 : highToCurrDist)) / updateItem.volume;
                    const newHighCDV = (((item.pricePerUnit - (item as any)['spread']) - updateItem.lowPrice) / (lowToCurrDist === 0 ? 1 : lowToCurrDist)) / updateItem.volume;    
                    
                    if (newLowCDV > currentCDV || updateItem.lowLoc === currentShip.ship.location) {
                        newUpdateItem.lowLoc = currLoc.symbol;
                        newUpdateItem.lowPrice = item.pricePerUnit + (item as any)['spread'];
                    }

                    if (newHighCDV > currentCDV || updateItem.highLoc === currentShip.ship.location) {
                        newUpdateItem.highLoc = currLoc.symbol;
                        newUpdateItem.highPrice = item.pricePerUnit  - (item as any)['spread'];
                    }

                    if (newUpdateItem.lowLoc === newUpdateItem.highLoc) {
                        if (newLowCDV >= newHighCDV) {
                            newUpdateItem.highPrice = updateItem.highPrice;
                            newUpdateItem.highLoc = updateItem.highLoc;
                        } else {
                            newUpdateItem.lowPrice = updateItem.lowPrice;
                            newUpdateItem.lowLoc = updateItem.lowLoc;
                        }
                    }

                    const newDist = distance(systemLocs.find(loc => loc.symbol === newUpdateItem.highLoc), systemLocs.find(loc => loc.symbol === newUpdateItem.lowLoc));
                    newUpdateItem.cdv = (newUpdateItem.highPrice - newUpdateItem.lowPrice) / (newDist === 0 ? 1 : newDist) / newUpdateItem.volume;
                    
                    marketGoods[updateIndex] = newUpdateItem;
                } else {
                    marketGoods.push({
                    symbol: item.symbol,
                    lowPrice: item.pricePerUnit + (item as any)['spread'],
                    lowLoc: location,
                    highPrice: item.pricePerUnit - (item as any)['spread'],
                    highLoc: location, 
                    volume: item.volumePerUnit,
                    cdv: 0,
                    });
                }
            }
        }
        // console.log(marketGoods);
        return marketData.location.marketplace;
    } else {
        return [];
    }
}

async function buyGoods(stationMarket: Marketplace[]) {

    let goodToBuy: Goods;
    let goodMarketData;
    let orderedMarket = _.orderBy(marketGoods, ['cdv'], ['desc']);

    if (currentShip.ship.location === orderedMarket[0].lowLoc) {
        goodToBuy = orderedMarket[0];
        goodMarketData = stationMarket.find(good => good.symbol === goodToBuy.symbol)
    } else {
        goodToBuy = orderedMarket.find(good => good.lowLoc === currentShip.ship.location && good.highLoc === orderedMarket[0].lowLoc);
        if (goodToBuy) {
            goodMarketData = stationMarket.find(good => good.symbol === goodToBuy.symbol);
        }
    }
    if (goodToBuy && goodMarketData) {
        const routeFuel = calculateFuelNeededForGood(goodToBuy.symbol).fuelNeeded;

        if (currentShip.ship.spaceAvailable > routeFuel && goodToBuy.cdv > 0 && (currentUser.credits - 3000 - (routeFuel * 2)) > goodToBuy.lowPrice) {
            let quantityToBuy = Math.floor((currentShip.ship.spaceAvailable - routeFuel) / goodToBuy.volume);
            if (goodToBuy.volume === 0) {
                quantityToBuy = Math.floor((currentUser.credits - 3000) / goodToBuy.lowPrice);
            }
            if ((quantityToBuy * (goodToBuy.lowPrice)) >= currentUser.credits) {
                quantityToBuy = Math.floor((currentUser.credits - 3000) / goodToBuy.lowPrice);
            }
            if (quantityToBuy >= goodMarketData.quantityAvailable) {
                quantityToBuy = goodMarketData.quantityAvailable - 1;
            }
            while (quantityToBuy > 0) {
                currentShip.ship.spaceAvailable -= quantityToBuy * goodToBuy.volume;
                try {
                    const order = await spaceTraders.purchaseGood(currentShip.ship.id, goodToBuy.symbol, (quantityToBuy > 300 ? 300 : quantityToBuy));
                    quantityToBuy -= 300;
                    currentShip.ship = order.ship;
                    currentUser.credits = order.credits;
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
        let goodToSellData: Goods = marketGoods.find((marketGood) => { return marketGood.symbol === goodToSell.good });
        while (fuelNeeded > currentShip.ship.spaceAvailable) {
            try {
                const o = await spaceTraders.sellGood(currentShip.ship.id, goodToSell.good, 1);
                currentShip.ship = o.ship;
            } catch (e) {
                try {
                    await spaceTraders.jettisonGoods(currentShip.ship.id, goodToSell.good, 1);
                    currentShip.ship.spaceAvailable += goodToSellData.volume;
                } catch (e) {
                    goodToSell = currentShip.ship.cargo.find((good) => { return good.good !== "FUEL" && good.good !== goodToSell.good});
                    if (goodToSell) {
                        goodToSellData = marketGoods.find((marketGood) => { return marketGood.symbol === goodToSell.good });
                    } else {
                        // stuck ship
                        return;
                    }
                    
                }
            }
        }
    }

    try {
        let tmp = await spaceTraders.purchaseGood(currentShip.ship.id, "FUEL", fuelNeeded);
        currentShip.ship = tmp.ship;
    } catch (e) {
        console.log(e);
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
    let orderedMarket = _.orderBy(marketGoods, ['cdv'], ['desc']);
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
    const fuelNeeded = Math.round(tripDist / 4) + penalty + 1;    
    return {targetDest: targetDest.symbol, fuelNeeded};
}

async function checkPurchaseNewShip() {
    const availShips = await spaceTraders.viewAvailableShips();
    for (let ship of availShips.ships) {
        for (let purchaseLocation of ship.purchaseLocations) {
            if (
                // Use 10,000 credits per ship as safe trading gap when buying new ships
                (((currentShips.filter(ship => ship.ship.manufacturer !== "Jackshaw").length * 10000) + purchaseLocation.price) <= currentUser.credits) &&
                shipsToBuy[ship.manufacturer][ship.class] > _.filter(currentShips, (currShip) => {
                    return (currShip.ship.manufacturer === ship.manufacturer && currShip.ship.class === ship.class);
                }).length
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
            const goodMarketData = marketGoods.find((good) => { return good.symbol === goodToShip});
            if (goodMarketData && goodMarketData.highLoc) {
                const targetDest = systemLocations.find((loc) => { return loc.symbol === goodMarketData.highLoc});
                const currentLoc = systemLocations.find((loc) => { return loc.symbol === currentShip.ship.location});
                if (targetDest && currentLoc && (targetDest.symbol !== currentLoc.symbol)) {
                    const distanceToMarket = distance(targetDest, currentLoc);
                    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
                    const mk2ShipPenalty = currentShip.ship.class === "MK-II" ? 1 : 0;
                    const mk3ShipPenalty = currentShip.ship.class === "MK-III" ? 2 : 0;
                    const fuelNeeded = Math.round(distanceToMarket / 4) + penalty + mk2ShipPenalty + mk3ShipPenalty + 1;
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

// setInterval(() => {
//     generateDisplay(currentShips, currentUser);
// }, 5000).unref();

