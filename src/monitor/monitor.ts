import * as blessed from 'blessed';
import * as _ from 'lodash';
import { User } from 'spacetraders-sdk/dist/types';
import { LoadedShip } from '..';

export function generateDisplay(ships: LoadedShip[], user: User) {

  let data = [['Credits ' + user.credits]];
  data.push(['Ship ID', 'Ship Type', 'Location', 'Cargo']);

  let screen = blessed.screen({
    smartCSR: true,
  });

  screen.title = 'Space Trader Monitor';

  data = data.concat(generateData(ships));

  let table = blessed.listtable({
    height: '100%',
    width: '100%',
    data: data,
    pad: 0,
    padding: 0,
    align: 'center',
    border: 'line',
  });

  screen.append(table);
  table.focus();
  screen.render();
}

function generateData(ships: LoadedShip[]) {
  const orderedShips = _.sortBy(ships, ['ships.id']);

  let data: string[][] = [];
  for (const ship of orderedShips) {
    data.push([ship.ship.id, ship.ship.type, ship.ship.location || 'In Transit', (ship.ship.maxCargo - ship.ship.spaceAvailable)+'/'+ship.ship.maxCargo]);
  }

  return data;
}