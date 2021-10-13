import { map, route, startMarker } from "./map.js";

let routingResult;
let index = 0;

async function requestRoutes(lat, lon, distance){
    const response = await fetch(`https://europe-central2-routeplanner-328709.cloudfunctions.net/RoutePlannerAPI?lat=${lat}&lon=${lon}&distance=${distance}`);
    const data = await response.json();
    return data
}

document.getElementById("generate-runs").onclick = generateButton;

function generateButton(){
    const distance = document.getElementById("run-length").value

    if(distance === "" || distance > 10 || distance < 1){
        alert("Please input a valid distance between 1 and 10 km.")
        return
    } 
    if(startMarker === undefined){
        alert("Please place a marker on the start location.")
        return
    }

    let lat = (startMarker.getLatLng()).lat
    let lon = (startMarker.getLatLng()).lng

    requestRoutes(lat, lon, distance).then(function success(res){
        routingResult = res
        index = 0
        document.getElementById('next-run').style.display = 'inline'
        route.setLatLngs(routingResult[0].path)
        route.bindPopup(`Distance: ${(routingResult[0].distance/1000).toFixed(2)} km.`)
    }).catch(function fail(err){
        alert(err)
        return
    })
    
}

document.getElementById("next-run").onclick = nextButton;


function nextButton(){
    index += 1
    index = index % routingResult.length
    route.setLatLngs(routingResult[index].path)
    route.bindPopup(`Distance: ${(routingResult[index].distance/1000).toFixed(2)} km.`)
}