import * as _ from 'lodash';
import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, Marketplace, YourShip, LocationsResponse, MarketplaceResponse, AccountResponse, User, SellResponse, PurchaseResponse, Ship, Location } from 'spacetraders-sdk/dist/types';
import { generateDisplay } from './monitor/monitor';

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

spaceTraders.init("Dunador", "100f6044-8168-4c74-a51e-896719f3196e");
let currentShips: LoadedShip[] = [];
let currentShip: LoadedShip;
let marketGoods: Goods[] = [];
let currentUser: User;
const shipsToBuy: any = {
    Gravager: {
        "MK-I": 20,
        "MK-II":10,
        "MK-III":5,
    },
    Jackshaw: {
        "MK-I": 10,
        "MK-II":0,
        "MK-III":0,
    },
    Electrum: {
        "MK-I":0,
        "MK-II":0,
        "MK-III":0,
    },
    Zetra: {
        "MK-I":0,
        "MK-II":0,
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
        await delay(10000);
    }
}

async function doSomething() {
    if (currentShip.ship.location) {
        const stationMarket = await updateMarketData(currentShip.ship.location);
        await sellGoods(stationMarket);
        await delay(500);
        await buyGoods(stationMarket);
        await navigate();
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
                    await delay(500);
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

    console.log(marketData);

    for (const item of marketData.location.marketplace) {
        console.log(item);
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
                let newUpdateItem = _.cloneDeep(updateItem);

                if (((item.pricePerUnit - updateItem.lowPrice) / (lowToCurrDist === 0 ? 1 : lowToCurrDist)) > ((updateItem.highPrice - updateItem.lowPrice) / (currentDist === 0 ? 1 : currentDist)) || updateItem.highLoc === currLoc.symbol) {
                    newUpdateItem.highPrice = item.pricePerUnit - (item as any)['spread'];
                    newUpdateItem.highLoc = location;
                } else if (((updateItem.highPrice - item.pricePerUnit) / (highToCurrDist === 0 ? 1 : highToCurrDist)) > ((updateItem.highPrice - updateItem.lowPrice) / (currentDist === 0 ? 1 : currentDist)) || updateItem.lowLoc === currLoc.symbol) {
                    newUpdateItem.lowPrice = item.pricePerUnit + (item as any)['spread'];
                    newUpdateItem.lowLoc = location;
                }

                newUpdateItem.cdv = (newUpdateItem.highPrice - newUpdateItem.lowPrice) / distance(systemLocs.find(loc => loc.symbol === newUpdateItem.highLoc), systemLocs.find(loc => loc.symbol === newUpdateItem.lowLoc));
                
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
    console.log(marketGoods);
    return marketData.location.marketplace;
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
        goodMarketData = stationMarket.find(good => good.symbol === goodToBuy.symbol)
    }
    if (goodToBuy && goodMarketData) {
        const routeFuel = calculateFuelNeededForGood(goodToBuy.symbol).fuelNeeded;

        if (currentShip.ship.spaceAvailable > routeFuel && goodToBuy.cdv > 0 && (currentUser.credits - 500) > goodToBuy.lowPrice) {
            let quantityToBuy = Math.floor((currentShip.ship.spaceAvailable - routeFuel) / goodToBuy.volume);
            if (goodToBuy.volume === 0) {
                quantityToBuy = Math.floor((currentUser.credits - 3000) / goodToBuy.lowPrice);
            }
            if ((quantityToBuy * (goodToBuy.lowPrice)) >= currentUser.credits) {
                quantityToBuy = Math.floor((currentUser.credits - 3000) / goodToBuy.lowPrice);
            }
            if (quantityToBuy >= ) {
                quantityToBuy = goodMarketData.quantityAvailable - 1;
            }
            if (quantityToBuy > 0) {
                currentShip.ship.spaceAvailable -= quantityToBuy * goodToBuy.volume;
                try {
                    const order = await spaceTraders.purchaseGood(currentShip.ship.id, goodToBuy.symbol, quantityToBuy);
                    currentShip.ship = order.ship;
                    currentUser.credits = order.credits;
                    await delay(500);
                } catch (e) {
                    console.log(e);
                }
            }
        }
    }
    
}

async function navigate() {
    const targetData = await calculateFuelNeededForGood();
    const targetDest = targetData.targetDest;
    const fuelNeeded = targetData.fuelNeeded;
    let goodToSell: Cargo = currentShip.ship.cargo.find((good) => { return good.good !== "FUEL" && good.good !== "RESEARCH"});
    if (!_.isEmpty(goodToSell)) {
        let goodToSellData: Goods = marketGoods.find((marketGood) => { return marketGood.symbol === goodToSell.good });
        while (fuelNeeded > currentShip.ship.spaceAvailable) {
            try {
                const o = await spaceTraders.sellGood(
                    currentShip.ship.id, goodToSell.good, 1);
                currentShip.ship = o.ship;
            } catch (e) {
                try {
                    await spaceTraders.jettisonGoods(currentShip.ship.id, goodToSell.good, 1);
                    currentShip.ship.spaceAvailable += goodToSellData.volume;
                } catch (e) {
                    goodToSell = currentShip.ship.cargo.find((good) => { return good.good !== "FUEL" && good.good !== "RESEARCH" && good.good !== goodToSell.good});
                    goodToSellData = marketGoods.find((marketGood) => { return marketGood.symbol === goodToSell.good });
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
        await spaceTraders.createFlightPlan(currentShip.ship.id, targetDest);
        currentShip.lastLocation = currentShip.ship.location;
    } catch (e) {
        console.log(e);
    }
}

function backupNavigation(systemLocs: Location[]) {
    let orderedMarket = _.orderBy(marketGoods, ['cdv'], ['desc']);
    const targetDest = systemLocs.find(loc => loc.symbol === orderedMarket[0].lowLoc);
    const currentLoc = systemLocs.find(loc => loc.symbol === currentShip.ship.location);
    const tripDist = distance(targetDest, currentLoc);

    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
    const fuelNeeded = Math.round(tripDist / 4) + penalty + 1;
    return {targetDest: targetDest.symbol, fuelNeeded};
}

async function checkPurchaseNewShip() {
    const availShips = await spaceTraders.viewAvailableShips();
    for (let ship of availShips.ships) {
        for (let purchaseLocation of ship.purchaseLocations) {
            if (
                // Use 20,000 credits per ship as safe trading gap when buying new ships
                (((currentShips.length * 20000) + purchaseLocation.price) <= currentUser.credits) &&
                shipsToBuy[ship.manufacturer][ship.class] > _.filter(currentShips, (currShip) => {
                    return (currShip.ship.manufacturer === ship.manufacturer && currShip.ship.class === ship.class);
                }).length
            ) {
                try {
                    await spaceTraders.purchaseShip(purchaseLocation.location, ship.type);
                    currentUser.credits -= purchaseLocation.price;
                    await delay(500);
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
            goodToShip = currentShip.ship.cargo.find((good) => { return (good.good !== "FUEL") }).good;
        }
        if (goodToShip) {
            const goodMarketData = marketGoods.find((good) => { return good.symbol === goodToShip});
            if (goodMarketData && goodMarketData.highLoc) {
                const targetDest = systemLocations.find((loc) => { return loc.symbol === goodMarketData.highLoc});
                const currentLoc = systemLocations.find((loc) => { return loc.symbol === currentShip.ship.location});
                if (targetDest && currentLoc && (targetDest.symbol !== currentLoc.symbol)) {
                    const distanceToMarket = distance(targetDest, currentLoc);
                    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
                    const shipPenalty = currentShip.ship.class === "MK-II" ? 1 : 0;
                    const fuelNeeded = Math.round(distanceToMarket / 4) + penalty + shipPenalty + 1;
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

