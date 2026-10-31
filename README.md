# routeplanner-frontend
This repository contains the frontend of [Loops](https://yurachistic1.github.io/routeplanner-frontend/). 
Loops suggests circular runs from a start point and a target distance. The map is drawn with MapLibre GL on OpenFreeMap vector tiles. 

To see the code that powers the app see this [repository](https://github.com/yurachistic1/routeplanner-backend).

## How to use
1. Tap the map to drop your start point (drag the pin to adjust).
2. Pick a distance between 1 and 35 km and press "Generate".
3. Flip through the loops with the arrows, or open "All routes" to see them side by side, then export the one you like as GPX.

Map data only covers London for now.

## Running locally
No build step. Serve the folder and run the backend alongside it:

```sh
python3 -m http.server 5173
```

When the page is served from localhost it calls the local backend on `http://localhost:8080/`.
