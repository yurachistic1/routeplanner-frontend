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
        document.getElementById('top').style.display = 'grid'
        route.setLatLngs(routingResult[0].path)
        document.getElementById("runNo").innerText = `1/${routingResult.length}`
        document.getElementById("runLen").innerText = `Distance: ${(routingResult[0].distance/1000).toFixed(2)} km.`
    }).catch(function fail(err){
        alert(err)
        return
    })
    
}

document.getElementById("next-run").onclick = nextButton;
document.getElementById("prev-run").onclick = prevButton;


function nextButton(){
    index += 1
    index = index % routingResult.length
    route.setLatLngs(routingResult[index].path)
    document.getElementById("runNo").innerText = `${index + 1}/${routingResult.length}`
    document.getElementById("runLen").innerText = `Distance: ${(routingResult[index].distance/1000).toFixed(2)} km.`
}

function prevButton(){
    index -= 1
    if(index < 0) {
        index = routingResult.length - 1
    }
    route.setLatLngs(routingResult[index].path)
    document.getElementById("runNo").innerText = `${index + 1}/${routingResult.length}`
    document.getElementById("runLen").innerText = `Distance: ${(routingResult[index].distance/1000).toFixed(2)} km.`
}

document.getElementById("download-run").onclick = downloadGPX;

function downloadGPX(){
    
    let xml = '<gpx xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd" version="1.1" creator="routeplanner"><trk><trkseg>'

    for(const pair of routingResult[index].path){
        xml += `<trkpt lat="${pair[0]}" lon="${pair[1]}"></trkpt>`
    }

    xml += '</trkseg></trk></gpx>'
    const url = 'data:text/json;charset=utf-8,' + xml
    const link = document.getElementById("download-link")
    link.download = `${(routingResult[index].distance/1000).toFixed(2)}km.gpx`
    link.href = url

    link.click()
}