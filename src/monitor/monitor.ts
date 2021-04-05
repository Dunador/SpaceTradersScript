import * as blessed from 'blessed';
import * as _ from 'lodash';
import { User } from 'spacetraders-sdk/dist/types';
import { LoadedShip } from '..';

let screen = blessed.screen({
  smartCSR: true,
});

screen.title = 'Space Trader Monitor';

let table = blessed.listtable({
  height: '100%',
  width: '100%',
  pad: 0,
  padding: 0,
  align: 'center',
  border: 'line',
  alwaysScroll: true,
  scrollable: true,
  scrollbar: {
    style: {
      bg: 'yellow'
    },
  },
  keys: true,
});

screen.append(table);

screen.key(['escape', 'q', 'C-c'], function(ch, key) {
  return process.exit(0);
});

export function generateDisplay(ships: LoadedShip[], user: User) {

  let data = [['Credits ' + user.credits]];
  data.push(['Ship ID', 'Ship Type', 'Location', 'Cargo']);
  data = data.concat(generateData(ships));
  table.setData(data);
  table.focus();
  screen.render();
}

function generateData(ships: LoadedShip[]) {
  const orderedShips = _.sortBy(ships, ['ships.id']);

  let data: string[][] = [];
  for (const ship of orderedShips) {
    data.push([ship.ship.id, ship.ship.type, ship.ship.location || 'In Transit', (ship.ship.maxCargo - ship.ship.spaceAvailable)+'/'+ship.ship.maxCargo]);
  }

  data = _.orderBy(data, (item) => {
    return item[2];
  });

  return data;
}