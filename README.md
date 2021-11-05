# routeplanner-frontend
This repository contains code for the frontend portion of the [routeplanner app](https://yurachistic1.github.io/routeplanner-frontend/). 
The app suggests circular walks or runs based on start location and desired distance. 

To see the code that powers the app see this [repository](https://github.com/yurachistic1/routeplanner-backend)

## How to use
1. Place a marker anywhere on the map(ideally next to roads and paths). 
2. Specify distance(does not have to be a whole number) between 1km and 10km and press "generate".

It will take a few seconds on account of map data having to be downloaded by the server and then best results will be displayed. The reason distances above 10km are 
not an option is because it would take too long to download bigger areas. 
