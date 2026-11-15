export interface Place {
  person: string;
  city: string;
  timeZone: string;
  lat: number;
  lon: number;
  hour12: boolean;
}

// Edit these, or override from the URL: ?me=Juan&her=Ana
const params = new URLSearchParams(location.search);

export const left: Place = {
  person: params.get('me') ?? 'Me',
  city: 'Cambridge',
  timeZone: 'Europe/London',
  lat: 52.2053,
  lon: 0.1218,
  hour12: params.get('h12') === '1',
};

export const right: Place = {
  person: params.get('her') ?? 'Her',
  city: 'Plano',
  timeZone: 'America/Chicago',
  lat: 33.0198,
  lon: -96.6989,
  hour12: params.get('h24') !== '1',
};
