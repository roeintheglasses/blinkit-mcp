import { get } from "http";

interface GeoResult {
  latitude: number;
  longitude: number;
}

export function getLocationFromIP(): Promise<GeoResult | null> {
  return new Promise((resolve) => {
    const timeout = setTimeout(() => resolve(null), 3000);
    try {
      get("http://ip-api.com/json/", { timeout: 3000 }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          clearTimeout(timeout);
          try {
            const json = JSON.parse(data);
            if (json.status === "success") {
              resolve({ latitude: json.lat, longitude: json.lon });
            } else {
              resolve(null);
            }
          } catch {
            resolve(null);
          }
        });
        res.on("error", () => {
          clearTimeout(timeout);
          resolve(null);
        });
      }).on("error", () => {
        clearTimeout(timeout);
        resolve(null);
      });
    } catch {
      clearTimeout(timeout);
      resolve(null);
    }
  });
}
