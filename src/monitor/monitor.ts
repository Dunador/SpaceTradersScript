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

let marketDataTable = blessed.listtable({
  top: 0,
  left: 0,
  padding: 0,
  height: "50%",
  width: "100%",
  keys: true,
  mouse: true,
  alwaysScroll: true,
  scrollable: true,
  border: "line",
  scrollbar: {
    style: {
      ch: " ",
      bg: "red",
    },
  },
});

screen.append(marketDataTable);

let table = blessed.listtable({
  bottom: 0,
  left: 0,
  height: "50%",
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

marketDataTable.key(["tab"], (ch, key) => {
  table.focus();
});

table.key(["tab"], (ch, key) => {
  marketDataTable.focus();
});

export function generateDisplay(
  ships: LoadedShip[],
  marketGoods: Map<string, Goods[]>
) {
  let data = [
    [
      "Credits Ƶ" + currencyFormatter.format(globals.getCredits()),
      "",
      "",
      "",
      "Ship Count: " + ships.length,
    ],
    ["Ship ID", "Ship Type", "Location", "Cargo Space", "Cargo Items"],
  ];
  data = data.concat(generateData(ships));
  table.setData(data);

  let marketData = [
    ["Item", "High Price", "High Loc", "Low Price", "Low Loc", "CDV"],
  ];
  marketData.push([]);
  marketData.push(["OE System"]);
  marketData = marketData.concat(
    _.orderBy(marketGoods.get("OE"), ["cdv"], ["desc"]).map((item) => {
      return [
        item.symbol,
        item.highPrice.toString(),
        item.highLoc,
        item.lowPrice.toString(),
        item.lowLoc,
        item.cdv.toString(),
      ];
    })
  );
  marketData.push([]);
  marketData.push(["XV System"]);
  marketData = marketData.concat(
    _.orderBy(marketGoods.get("XV"), ["cdv"], ["desc"]).map((item) => {
      return [
        item.symbol,
        item.highPrice.toString(),
        item.highLoc,
        item.lowPrice.toString(),
        item.lowLoc,
        item.cdv.toString(),
      ];
    })
  );

  marketData.push([]);
  marketData.push(["Cross System"]);
  marketData = marketData.concat(_.orderBy(globals.bestRoutesUniversally, ["cdv"], ["desc"]).map((item) => {
    return [
      item.symbol,
      item.highPrice.toString(),
      item.highLoc,
      item.lowPrice.toString(),
      item.lowLoc,
      item.cdv.toString(),
    ];
  }));

  marketDataTable.setData(marketData);

  screen.render();
}

function generateData(ships: LoadedShip[]) {
  const orderedShips = _.sortBy(ships, ["ships.id"]);

  let data: string[][] = [];
  for (const ship of orderedShips) {
    data.push([
      ship.ship.id,
      ship.ship.type,
      ship.ship.location || "In Transit",
      ship.ship.maxCargo - ship.ship.spaceAvailable + "/" + ship.ship.maxCargo,
      ship.ship.cargo
        .map((item) => item.good + " x " + item.quantity)
        .filter((item) => item)
        .join(", "),
    ]);
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
