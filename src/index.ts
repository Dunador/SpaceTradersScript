import { update } from 'lodash';
import _ = require('lodash');
import { SpaceTraders } from 'spacetraders-sdk';
import { Cargo, Marketplace, YourShip, Good, LocationResponse, LocationsResponse } from 'spacetraders-sdk/dist/types';

export interface LoadedShip {
    ship: YourShip,
    cargoCost?: number,
}

export interface Goods {
    symbol: string,
    highPrice: number,
    lowPrice: number,
    highLoc: string,
    lowLoc: string,
}

const delay = (ms: number) => new Promise(res => setTimeout(res, ms));
const spaceTraders = new SpaceTraders();

spaceTraders.init("Dunador", "15839b0b-d146-4c90-b70d-79cf834d1e8a");
let currentShips: LoadedShip[] = [];
let marketGoods: Goods[] = [];

async function main() {
    while(true) {
        const userResponse = await spaceTraders.getAccount();
        if(_.isEmpty(currentShips)) {
            userResponse.user.ships.forEach((ship) => {
                let addShip: LoadedShip = {ship, cargoCost: 0};
                currentShips.push(addShip);
            });
        }
        currentShips.forEach(async (cargoShip) => {

            let shipLoc = cargoShip.ship.location;
            console.log("Ship currently at: "+shipLoc);
            console.log("Current Credits: "+userResponse.user.credits);
    
            if (!_.isEmpty(shipLoc)) {
                await doSomething(cargoShip);
            }
        });
    }
}

async function doSomething(cargoShip: LoadedShip) {
    if (cargoShip.ship.location) {
        const stationMarket = await updateMarketData(cargoShip.ship.location);
        await sellGoods(cargoShip, stationMarket);
        await buyGoods(cargoShip, stationMarket);
        await navigate(cargoShip);
    }
}

async function sellGoods(cargoShip: LoadedShip, stationMarket: Marketplace[]) {
    if (cargoShip.ship.cargo.length > 0) {
        cargoShip.ship.cargo.forEach(async (item) => {
            if(item.good !== "FUEL") {
                const stationGood = stationMarket.find((good) => { good.symbol === item.good});
                if (stationGood) {
                    const potentialGain = item.quantity * stationGood.pricePerUnit - (cargoShip.cargoCost || 0);
                    if (potentialGain > 0) {
                        await spaceTraders.sellGood(cargoShip.ship.id, item.good, item.quantity);
                        console.log("Ship "+cargoShip.ship.id+" selling "+item.good+" for "+stationGood.pricePerUnit * item.quantity);
                        cargoShip.ship.spaceAvailable =+ (item.quantity * stationGood.volumePerUnit);
                    }
                }
            }
        })
    }
}

async function updateMarketData(location: string) {
    const marketData = await spaceTraders.getMarketplace(location);
    marketData.location.marketplace.forEach((item) => {
        let updateItem = _.clone(marketGoods.find((good) => {good.symbol == item.symbol}));
        if (updateItem) {
            updateItem.highPrice = (item.pricePerUnit > updateItem.highPrice ? item.pricePerUnit : updateItem.highPrice);
            updateItem.lowPrice = (item.pricePerUnit < updateItem.lowPrice ? item.pricePerUnit : updateItem.lowPrice);
            updateItem.highLoc = (item.pricePerUnit > updateItem.highPrice ? location : updateItem.highLoc);
            updateItem.lowLoc = (item.pricePerUnit < updateItem.lowPrice ? location : updateItem.lowLoc);
        } else {
            marketGoods.push({
               symbol: item.symbol,
               lowPrice: item.pricePerUnit,
               lowLoc: location,
               highPrice: item.pricePerUnit,
               highLoc: location, 
            });
        }
    });
    return marketData.location.marketplace;
}

async function buyGoods(cargoShip: LoadedShip, stationMarket: Marketplace[]) {
    // 20 used for fuel considerations.
    if(cargoShip.ship.spaceAvailable > 20) {
        let largestPriceGapGood: string = '';
        let largestPriceGap: number = 0;
        stationMarket.forEach(async (good) => {
            const itemData = marketGoods.find((item) => { good.symbol === item.symbol});
            if (itemData) {
                // Check for insufficient data on goods
                if (itemData.highPrice !== itemData.lowPrice) {
                    largestPriceGap = (itemData.highPrice - good.pricePerUnit > largestPriceGap) ? itemData.highPrice - good.pricePerUnit : largestPriceGap;
                    largestPriceGapGood = (itemData.highPrice - good.pricePerUnit > largestPriceGap) ? good.symbol : largestPriceGapGood;
                    if (itemData.lowPrice === good.pricePerUnit) {
                        const quantityToBuy = Math.floor((cargoShip.ship.spaceAvailable - 20) / good.volumePerUnit);
                        cargoShip.ship.spaceAvailable -= quantityToBuy * good.volumePerUnit;
                        console.log("Ship "+cargoShip.ship.id+" buying "+good.symbol+" for "+good.pricePerUnit * quantityToBuy);
                        await spaceTraders.purchaseGood(cargoShip.ship.id, good.symbol, quantityToBuy);
                    }
                }
            }
        });
        if (cargoShip.ship.spaceAvailable > 20) {
            const goodToBuy = stationMarket.find((good) => { good.symbol === largestPriceGapGood});
            if (goodToBuy) {
                const quantityToBuy = Math.floor((cargoShip.ship.spaceAvailable - 20) / goodToBuy.volumePerUnit);
                cargoShip.ship.spaceAvailable -= quantityToBuy * goodToBuy.volumePerUnit;
                console.log("Ship "+cargoShip.ship.id+" buying "+goodToBuy.symbol+" for "+goodToBuy.pricePerUnit * quantityToBuy);
                await spaceTraders.purchaseGood(cargoShip.ship.id, goodToBuy.symbol, quantityToBuy);
            }
        }
    }
}

async function navigate(cargoShip: LoadedShip) {
    const systemLocations = await spaceTraders.listLocations("OE");
    if (cargoShip.ship.cargo.length > 0) {
        let goodToShip = cargoShip.ship.cargo.find((good) => { good.good != "FUEL"});
        if (goodToShip) {
            const goodMarketData = marketGoods.find((good) => { good.symbol === goodToShip?.good});
            if (goodMarketData && goodMarketData.highLoc) {
                const targetDest = systemLocations.locations.find((loc) => { loc.symbol === goodMarketData.highLoc});
                const currentLoc = systemLocations.locations.find((loc) => { loc.symbol === cargoShip.ship.location});
                if (targetDest && currentLoc) {
                    const distanceToMarket = distance(targetDest.x, currentLoc.x, targetDest.y, currentLoc.y);
                    const penalty = currentLoc.type.toLowerCase() === "planet" ? 2 : 0;
                    const fuelNeeded = Math.round(distanceToMarket / 4) + penalty + 1;
                    while (fuelNeeded > cargoShip.ship.spaceAvailable) {
                        const volumeOfGood = (cargoShip.ship.maxCargo - cargoShip.ship.spaceAvailable) / goodToShip.quantity;
                        await spaceTraders.sellGood(cargoShip.ship.id, goodToShip.good, 1);
                        cargoShip.ship.spaceAvailable += volumeOfGood;
                    }
                    await spaceTraders.purchaseGood(cargoShip.ship.id, "FUEL", fuelNeeded);
                    await spaceTraders.createFlightPlan(cargoShip.ship.id, targetDest.symbol);
                }
            } else {
                await backupNavigation(cargoShip, systemLocations);
            }
        }
    } else {
        await backupNavigation(cargoShip, systemLocations);
    }
}

async function backupNavigation(cargoShip: LoadedShip, systemLocs: LocationsResponse) {
    let shortestTrip = cargoShip.ship.location;
    let shortestTripDist = 100;
    const currentLoc = systemLocs.locations.find((loc) => { loc.symbol === cargoShip.ship.location});
    if (currentLoc) {
        systemLocs.locations.forEach((loc) => {
            if (loc.symbol !== currentLoc.symbol) {
                const distToLoc = distance(currentLoc.x, loc.x, currentLoc.y, loc.y);
                shortestTripDist = (distToLoc < shortestTripDist) ? distToLoc : shortestTripDist;
                shortestTrip = (distToLoc < shortestTripDist) ? loc.symbol : shortestTrip;
            }
        });
        const targetLoc = systemLocs.locations.find((loc) => { loc.symbol === shortestTrip});
        if (targetLoc) {
            const penalty = targetLoc.type.toLowerCase() === "planet" ? 2 : 0;
            const fuelNeeded = Math.round(shortestTripDist / 4) + penalty + 1;
            let goodToShip = cargoShip.ship.cargo.find((good) => { good.good != "FUEL"});
            while (fuelNeeded > cargoShip.ship.spaceAvailable) {
                const volumeOfGood = (cargoShip.ship.maxCargo - cargoShip.ship.spaceAvailable) / (goodToShip as Cargo).quantity;
                await spaceTraders.sellGood(cargoShip.ship.id, (goodToShip as Cargo).good, 1);
                cargoShip.ship.spaceAvailable += volumeOfGood;
            }
            await spaceTraders.purchaseGood(cargoShip.ship.id, "FUEL", fuelNeeded);
            await spaceTraders.createFlightPlan(cargoShip.ship.id, shortestTrip as string);
        }
    } 
}

function distance(x1: number, x2: number, y1: number, y2: number) {
    const xdiff = Math.pow(x2 - x1, 2);
    const ydiff = Math.pow(y2 - y1, 2);
    return Math.ceil(Math.sqrt(xdiff+ydiff));
}

main();

