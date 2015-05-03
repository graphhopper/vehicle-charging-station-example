$(document).ready(function (e) {
    jQuery.support.cors = true;

    //
    // Sign-up for free and get your own key: https://graphhopper.com/#directions-api
    //
    var defaultKey = "[YOUR-KEY]";
    var profile = "car";

    // create a routing client to fetch real routes, elevation.true is only supported for vehicle bike or foot
    var ghRouting = new GraphHopperRouting({key: defaultKey, vehicle: profile, elevation: false});
    var ghMatrix = new GraphHopperMatrix({key: defaultKey, vehicle: profile});
    ghMatrix.addOutArray('times');
    ghMatrix.addOutArray('distances');

    $("#response").html("Calculating Matrix requests ...");

    var routingMap = createMap('routing-map');

    routingMap.setView([52.521235, 13.3992], 6);
    var routingLayer = L.geoJson().addTo(routingMap);
    routingLayer.options = {
        style: {color: "#00cc33", "weight": 5, "opacity": 0.6}
    };

    var stations = [];
    var maxRange = 426000;

    // TODO 
    // 1. calculate if we need multiple hops
    // 2. calculate filter distance

    // smaller filter distance if you have only the free package
    var filterDistance = maxRange / 1;
    var start = new L.LatLng(53.507651, 10.008545);
    var destination = new L.LatLng(48.114767, 11.590576);

    // calculate middle point of the route to filter charging stations
    var center = new L.LatLng((start.lat + destination.lat) / 2, (start.lng + destination.lng) / 2);

    // charging_stations provided via charging_stations_export.js from OpenStreetMap/overpass API
    for (var statIndex = 0; statIndex < charging_stations.features.length; statIndex++) {
        var station = charging_stations.features[statIndex];
        var c;
        if (station.geometry.type === "Point") {
            c = station.geometry.coordinates;
        } else {
            c = station.geometry.coordinates[0][0];
        }
        var p = new L.LatLng(c[1], c[0]);
        p.osm_link = "https://www.openstreetmap.org/" + station.id;
        if (p.distanceTo(center) < filterDistance) {
            stations.push(p);
        }
    }

    ghMatrix.addFromPoint(new GHInput(start.lat, start.lng));
    for (var sIndex in stations) {
        var s = stations[sIndex];
        ghMatrix.addToPoint(new GHInput(s.lat, s.lng));
    }

    ghMatrix.doRequest(function (startJson) {
        if (startJson.message) {
            var str = "An error occured for 'start'-request: " + startJson.message;
            if (startJson.hints)
                str += startJson.hints;

            $("#matrix-error").text(str);
        } else {

            ghMatrix.clearPoints();

            for (var sIndex in stations) {
                var s = stations[sIndex];
                ghMatrix.addFromPoint(new GHInput(s.lat, s.lng));
            }
            ghMatrix.addToPoint(new GHInput(destination.lat, destination.lng));

            ghMatrix.doRequest(function (destJson) {
                if (destJson.message) {
                    var str = "An error occured for 'destination'-request: " + destJson.message;
                    if (destJson.hints)
                        str += destJson.hints;

                    $("#matrix-error").text(str);
                } else {
                    var bestStationIndex = -1;
                    var bestTime = 1e20;
                    var worstDistance = 1;

                    for (var i = 0; i < stations.length; i++) {
                        var startDist = startJson.distances[0][i];
                        var destDist = destJson.distances[i][0];

                        // accept station only if both distances are within the range                        
                        if (startDist < maxRange && destDist < maxRange) {
                            // pick best
                            var fullTime = startJson.times[0][i] + destJson.times[i][0];
                            if (fullTime < bestTime) {
                                bestTime = fullTime;
                                bestStationIndex = i;
                            }

                            if (startDist + destDist > worstDistance) {
                                worstDistance = startDist + destDist;
                            }
                        }
                    }
                    if (bestStationIndex < 0) {
                        $("#matrix-error").text("No tour found with maximum range " + maxRange);
                    } else {

                        ghRouting.clearPoints();

                        ghRouting.addPoint(new GHInput(start.lat, start.lng));
                        var pickedStation = stations[bestStationIndex];
                        ghRouting.addPoint(new GHInput(pickedStation.lat, pickedStation.lng));
                        ghRouting.addPoint(new GHInput(destination.lat, destination.lng));

                        addPointToMap(routingLayer, start.lat, start.lng, 0);
                        addPointToMap(routingLayer, pickedStation.lat, pickedStation.lng, 1);
                        addPointToMap(routingLayer, destination.lat, destination.lng, 2);

                        ghRouting.doRequest(function (json) {
                            if (json.message) {
                                var str = "An error occured: " + json.message;
                                if (json.hints)
                                    str += json.hints;

                                $("#matrix-error").text(str);
                                return;
                            }

                            var path = json.paths[0];
                            routingLayer.addData({
                                "type": "Feature",
                                "geometry": path.points
                            });

                            if (path.bbox) {
                                var minLon = path.bbox[0];
                                var minLat = path.bbox[1];
                                var maxLon = path.bbox[2];
                                var maxLat = path.bbox[3];
                                var tmpB = new L.LatLngBounds(new L.LatLng(minLat, minLon), new L.LatLng(maxLat, maxLon));
                                routingMap.fitBounds(tmpB);
                            }

                            var outHtml = "<a href=" + stations[bestStationIndex].osm_link + ">Best station<a> picked from " + stations.length + " stations";
                            outHtml += "<br/><b>Best</b> distance in km:" + Math.floor(path.distance / 1000);
                            outHtml += ", time in minutes:" + Math.floor(path.time / 1000 / 60);

                            outHtml += "<br/><b>Worst</b> distance:" + Math.floor(worstDistance / 1000);

                            outHtml += "<br/><a href='" + ghRouting.getGraphHopperMapsLink() + "'>GraphHopper Maps</a>";
                            $("#response").html(outHtml);
                        });
                    }
                }
            });
        }
    });
});

var iconObject = L.icon({
    iconUrl: './img/marker-icon.png',
    shadowSize: [50, 64],
    shadowAnchor: [4, 62],
    iconAnchor: [12, 40]
});
var addPointToMap = function (routingLayer, lat, lng, index) {
    index = parseInt(index);
    if (index === 0) {
        new L.Marker([lat, lng], {icon: iconObject}).addTo(routingLayer);
    } else {
        new L.Marker([lat, lng], {icon: iconObject}).addTo(routingLayer);
    }
};

function createMap(divId) {
    var osmAttr = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';
    var mapquest = L.tileLayer('http://{s}.mqcdn.com/tiles/1.0.0/osm/{z}/{x}/{y}.png', {
        attribution: osmAttr + ', <a href="http://open.mapquest.co.uk" target="_blank">MapQuest</a>',
        subdomains: ['otile1', 'otile2', 'otile3', 'otile4']
    });

    var openMapSurfer = L.tileLayer('http://openmapsurfer.uni-hd.de/tiles/roads/x={x}&y={y}&z={z}', {
        attribution: osmAttr + ', <a href="http://openmapsurfer.uni-hd.de/contact.html">GIScience Heidelberg</a>'
    });

    var omniscale = L.tileLayer.wms('https://maps.omniscale.net/v1/graphhp-7ae5b6f7/tile', {
        layers: 'osm',
        attribution: osmAttr + ', &copy; <a href="http://maps.omniscale.com/">Omniscale</a>'
    });

    var map = L.map(divId, {layers: [omniscale]});
    L.control.layers({"MapQuest": mapquest,
        "Omniscale": omniscale,
        "OpenMapSurfer": openMapSurfer, }).addTo(map);
    return map;
}