import { IntraSystemTrader } from './../classes/IntraSystemTrader';
import * as blessed from "blessed";
import * as _ from "lodash";
import { User } from "spacetraders-sdk/dist/types";
import { Goods, LoadedShip } from "../types";
import * as globals from "../utils/globals";

const currencyFormatter = Intl.NumberFormat("en-us", {
  maximumFractionDigits: 0,
  minimumFractionDigits: 0,
});

let screen = blessed.screen({
  smartCSR: true,
});

screen.title = "Space Trader Monitor";

let table = blessed.listtable({
  bottom: 0,
  left: 0,
  height: "100%",
  width: "100%",
  align: "center",
  border: "line",
  alwaysScroll: true,
  scrollable: true,
  scrollbar: {
    style: {
      fg: "orange",
      bg: "yellow",
    },
  },
  keys: true,
});

screen.append(table);
table.focus();

screen.key(["escape", "q", "C-c"], function (ch, key) {
  return process.exit(0);
});

export function generateDisplay(
  ships: IntraSystemTrader[],
) {
  let data = [
    [
      "Credits Ƶ" + currencyFormatter.format(globals.getCredits()),
      "",
      "",
      "",
      "Ship Count: " + ships.length,
    ],
    ["Ship ID", "Ship Type", "Location", "Cargo Space", "Cargo Items", "Targetting Item", "Item CDV"],
  ];
  data = data.concat(generateData(ships));
  table.setData(data);
  screen.render();
}

function generateData(ships: IntraSystemTrader[]) {
  const orderedShips = _.sortBy(ships, ["ships.id"]);

  let data: string[][] = [];

  for (const ship of orderedShips) {
    let marketRoutes = globals.getAllShips().find(x => x.ship.id === ship.ship.id).goodMap.get(ship.system).sort((a, b) => b.cdv - a.cdv);

    data.push([
      ship.ship.id,
      ship.ship.type,
      ship.ship.location || "In Transit",
      ship.ship.maxCargo - ship.ship.spaceAvailable + "/" + ship.ship.maxCargo,
      ship.ship.cargo
        .map((item) => item.good + " x " + item.quantity)
        .filter((item) => item)
        .join(", "),
      marketRoutes[0].symbol,
      marketRoutes[0].cdv.toString(),
    ],
);
  }

  data = _.orderBy(data, (item) => {
    return item[2];
  });

  return data;
}

export function log(output: string) {
  // consoleBox.pushLine(output);
  screen.render();
}
