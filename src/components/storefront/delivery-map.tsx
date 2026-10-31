"use client";

import { useEffect, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?url";

import "maplibre-gl/dist/maplibre-gl.css";

const MAP_STYLE_URL = "https://tiles.openfreemap.org/styles/liberty";

/**
 * MapLibre + OpenFreeMap, loaded only when a valid position exists.
 * The map is decorative: the freshness text beside it is the accessible
 * source of truth, and no route, distance or ETA is calculated.
 */
export function DeliveryMap({ latitude, longitude }: { latitude: number; longitude: number }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markerRef = useRef<Marker | null>(null);
  const latestRef = useRef({ latitude, longitude });
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    latestRef.current = { latitude, longitude };
  }, [latitude, longitude]);

  useEffect(() => {
    let disposed = false;

    void (async () => {
      try {
        const maplibregl = await import("maplibre-gl");

        if (disposed || !containerRef.current) {
          return;
        }

        // The bundler emits the worker as its own asset. Pointing MapLibre at it
        // keeps tile parsing off the main thread in dev and in production.
        maplibregl.setWorkerUrl(workerUrl);

        const map = new maplibregl.Map({
          container: containerRef.current,
          style: MAP_STYLE_URL,
          center: [latestRef.current.longitude, latestRef.current.latitude],
          zoom: 15,
          attributionControl: { compact: true },
          dragRotate: false,
          pitchWithRotate: false,
          scrollZoom: false,
        });

        mapRef.current = map;

        // Tile/style failures leave the marker and the freshness text intact.
        map.on("error", () => undefined);

        const markerElement = document.createElement("div");
        markerElement.className = "avd-driver-marker";
        markerElement.setAttribute("data-testid", "delivery-marker");
        markerElement.setAttribute("role", "img");
        markerElement.setAttribute("aria-label", "Posição aproximada do entregador");

        markerRef.current = new maplibregl.Marker({
          element: markerElement,
          anchor: "center",
        })
          .setLngLat([latestRef.current.longitude, latestRef.current.latitude])
          .addTo(map);
      } catch {
        if (!disposed) {
          setFailed(true);
        }
      }
    })();

    return () => {
      disposed = true;
      markerRef.current?.remove();
      markerRef.current = null;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    markerRef.current?.setLngLat([longitude, latitude]);
    mapRef.current?.easeTo({ center: [longitude, latitude], duration: 600 });
  }, [latitude, longitude]);

  return (
    <div>
      <div
        ref={containerRef}
        data-testid="delivery-map"
        role="img"
        aria-label="Mapa com a posição aproximada do entregador"
        className={`h-60 w-full overflow-hidden rounded-xl border border-zinc-200 bg-zinc-100 ${
          failed ? "hidden" : ""
        }`}
      />

      {failed ? (
        <div
          data-testid="delivery-map-fallback"
          className="flex h-32 flex-col items-center justify-center rounded-xl border border-dashed border-zinc-300 bg-zinc-50 px-4 text-center"
        >
          <p className="text-sm font-medium text-zinc-700">Mapa indisponível neste dispositivo</p>
          <p className="mt-1 text-xs text-zinc-500">
            A última posição recebida e o horário continuam disponíveis abaixo.
          </p>
        </div>
      ) : null}
    </div>
  );
}
