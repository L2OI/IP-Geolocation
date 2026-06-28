let map;
let marker;

function createMarkerIcon(iconUrls = {}) {
  const iconUrl = iconUrls.iconUrl || 'images/marker-icon.svg';
  const iconRetinaUrl = iconUrls.iconRetinaUrl || iconUrl;

  return L.icon({
    iconUrl,
    iconRetinaUrl,
    iconSize: [32, 32],
    iconAnchor: [16, 32],
    popupAnchor: [0, -30],
    shadowUrl: undefined,
  });
}

function initMap() {
  map = L.map('map').setView([20, 0], 2);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png').addTo(map);
  marker = L.marker([0, 0], {
    opacity: 0,
    icon: createMarkerIcon(),
  }).addTo(map);
}

window.addEventListener('message', event => {
  const payload = event.data;
  const locationData = payload.location;
  const iconUrls = payload.iconUrls;

  if (map && marker && locationData && locationData.latitude && locationData.longitude) {
    const latLng = [locationData.latitude, locationData.longitude];
    map.setView(latLng, 13);
    if (iconUrls) {
      marker.setIcon(createMarkerIcon(iconUrls));
    }
    marker.setLatLng(latLng);
    marker.setOpacity(1);
    const popupContent = '<b>' + locationData.country + '</b><br>纬度: ' + locationData.latitude + '<br>经度: ' + locationData.longitude;
    marker.bindPopup(popupContent).openPopup();
  }
});

initMap();
