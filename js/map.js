// Map and tiles
const map = L.map('map').locate({setView: true, maxZoom: 14})

// add OpenStreetMap tiles
const tileUrl = 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png'
const attribution = '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>'
const tiles = L.tileLayer(tileUrl, { attribution })
tiles.addTo(map);

L.control.scale().addTo(map);

// Add marker on click 

let startMarker;

map.on('click', 
			function(e){
                if (startMarker){
                    startMarker.setLatLng(e.latlng)
                } else {
                    startMarker = L.marker(e.latlng).addTo(map);
                }
				
			});

// Add route without coordinates 

let route = L.polyline([], {color: 'blue', weight: 4, opacity: 0.55}).addTo(map);

export { map, startMarker, route }