// Map and tiles
const map = L.map('map').setView([0, 0], 2);

// add OpenStreetMap tiles
const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const attribution = '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>'
const tiles = L.tileLayer(tileUrl, { attribution })
tiles.addTo(map);

export { map }