# Cambridge ♥ Plano banner

Pixel-art banner with two live clocks for a Notion page. The sky on each side
follows the real sun and moon position for that city.

- `npm run dev`: local preview at http://localhost:5173
- `npm run build`: static site in `dist/`

URL options:
- `?me=Juan&her=Julie`: names on the clocks (these are the defaults)
- `?season=winter|spring|summer|autumn`: force a season (otherwise it follows each city's date)
- `?fireworks=1`: preview the fireworks (they run by themselves on New Year, on 5 November in Cambridge and on 4 July in Dallas)
- `?christmas=1`: preview the Christmas decorations (they're up by themselves from 20 November to 1 January)
- `?h12=1`: 12-hour clock on the Cambridge side; `?h24=1`: 24-hour on the Plano side
- `?at=2026-11-15T22:00:00Z`: freeze time (for previewing night or day)

## Put it in Notion
1. Push to a GitHub repo named e.g. `banner`, then go to Settings → Pages → Source: **GitHub Actions**.
2. The site deploys to `https://<user>.github.io/banner/`.
3. In Notion, type `/embed`, paste `https://<user>.github.io/banner/`,
   then drag the embed's bottom edge until there's no dark border (about 3.5:1).
