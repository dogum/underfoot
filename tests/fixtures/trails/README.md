# Trail fixtures

Ten trails from the National Park Service's [Public Trails](https://public-nps.opendata.arcgis.com/) dataset, one GPX file each, used by `scripts/validate-trails.mjs`. Each file's `<desc>` records the NPS feature ID, surface, trail class, mapping method and stated accuracy.

| File | Trail | Park | Surface | Mapped with |
| --- | --- | --- | --- | --- |
| `yose-mist-trail.gpx` | Mist Trail, footbridge to Vernal Fall | Yosemite | native | unknown |
| `yose-valley-loop.gpx` | Valley Loop Trail | Yosemite | native | GNSS, 1–5 m |
| `yose-four-mile.gpx` | Four Mile Trail | Yosemite | native | unknown |
| `zion-angels-landing.gpx` | Angels Landing Trail | Zion | native | unknown |
| `grca-bright-angel.gpx` | Bright Angel Trail | Grand Canyon | native | unknown |
| `mora-skyline.gpx` | Skyline Trail | Mount Rainier | native | air photo |
| `yell-midway-geyser-basin.gpx` | Midway Geyser Basin Trail | Yellowstone | boardwalk | unknown |
| `ever-anhinga.gpx` | Anhinga Trail | Everglades | boardwalk | unknown |
| `grsm-alum-cave.gpx` | Alum Cave Trail | Great Smoky Mountains | native | differential GPS, 1–5 m |
| `glac-hidden-lake.gpx` | Hidden Lake Trail | Glacier | earth | unknown |

The data is a work of the U.S. federal government and in the public domain. To add a trail or refresh these, edit the list in `scripts/fetch-trails.mjs` and run it.

The GPX files open in Underfoot itself (**GPX / CSV** in the toolbar) and in most hiking apps.
