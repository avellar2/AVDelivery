import { Capacitor, registerPlugin, type PluginListenerHandle } from "@capacitor/core";

import { getTrackingSession, shareDeliveryLocation } from "./api";
import { getSupabase } from "./supabase";
import {
  decideSend,
  isUsableFix,
  TRACKING_POLICY,
  type GeoFix,
  type PreviousSent,
} from "./tracking-policy";
import type { TrackingStatus } from "./types";

export type StartTrackingOptions = {
  deliveryId: string;
};

export type NativeTrackingStatus = TrackingStatus & {
  accessToken?: string | null;
  refreshToken?: string | null;
  expiresAt?: number | null;
  userId?: string | null;
  notificationGranted?: boolean;
};

type NativeStartOptions = {
  deliveryId: string;
  url: string;
  anonKey: string;
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  userId: string;
};

export interface DriverTrackingPlugin {
  start(options: NativeStartOptions): Promise<NativeTrackingStatus>;
  stop(): Promise<NativeTrackingStatus>;
  getStatus(): Promise<NativeTrackingStatus>;
  updateSession(options: {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;
  }): Promise<void>;
  requestNotificationPermission(): Promise<{ granted: boolean }>;
  addListener(
    eventName: "status",
    listener: (status: NativeTrackingStatus) => void,
  ): Promise<PluginListenerHandle>;
}

export const DriverTracking = registerPlugin<DriverTrackingPlugin>("DriverTracking");

export function emptyStatus(): TrackingStatus {
  return {
    running: false,
    deliveryId: null,
    state: "idle",
    message: null,
    lastSentAt: null,
    lastLatitude: null,
    lastLongitude: null,
    lastAccuracy: null,
    queued: 0,
    sentCount: 0,
  };
}

export type StatusListener = (status: NativeTrackingStatus) => void;

export type TrackingController = {
  readonly native: boolean;
  start(options: StartTrackingOptions): Promise<NativeTrackingStatus>;
  stop(): Promise<NativeTrackingStatus>;
  getStatus(): Promise<NativeTrackingStatus>;
  requestNotificationPermission(): Promise<boolean>;
  subscribe(listener: StatusListener): () => void;
};

function isNativeRuntime(): boolean {
  return Capacitor.isNativePlatform();
}

class NativeTrackingController implements TrackingController {
  readonly native = true;
  private listeners = new Set<StatusListener>();
  private pending: Promise<PluginListenerHandle> | null = null;

  private ensureListener(): Promise<PluginListenerHandle> {
    if (!this.pending) {
      this.pending = DriverTracking.addListener("status", (status) => {
        void this.syncSession(status);
        this.listeners.forEach((listener) => listener(status));
      });
    }

    return this.pending;
  }

  private async syncSession(status: NativeTrackingStatus): Promise<void> {
    if (!status.accessToken || !status.refreshToken) {
      return;
    }

    const supabase = getSupabase();
    const { data } = await supabase.auth.getSession();
    const current = data.session;

    if (current?.access_token === status.accessToken) {
      return;
    }

    await supabase.auth.setSession({
      access_token: status.accessToken,
      refresh_token: status.refreshToken,
    });
  }

  async start(options: StartTrackingOptions): Promise<NativeTrackingStatus> {
    const session = await getTrackingSession();

    if (!session) {
      throw new Error("Sua sessão expirou. Entre novamente.");
    }

    const supabase = getSupabase();
    supabase.auth.stopAutoRefresh();
    await this.ensureListener();

    try {
      const status = await DriverTracking.start({
        deliveryId: options.deliveryId,
        url: session.url,
        anonKey: session.anonKey,
        accessToken: session.accessToken,
        refreshToken: session.refreshToken,
        expiresAt: session.expiresAt,
        userId: session.userId,
      });

      await this.syncSession(status);
      return status;
    } catch (error) {
      supabase.auth.startAutoRefresh();
      throw error;
    }
  }

  async stop(): Promise<NativeTrackingStatus> {
    const status = await DriverTracking.stop();
    await this.syncSession(status);
    getSupabase().auth.startAutoRefresh();
    return status;
  }

  async getStatus(): Promise<NativeTrackingStatus> {
    const status = await DriverTracking.getStatus();
    await this.syncSession(status);
    return status;
  }

  async requestNotificationPermission(): Promise<boolean> {
    const { granted } = await DriverTracking.requestNotificationPermission();
    return granted;
  }

  subscribe(listener: StatusListener): () => void {
    this.listeners.add(listener);
    void this.ensureListener();
    void this.getStatus()
      .then((status) => listener(status))
      .catch(() => undefined);

    return () => {
      this.listeners.delete(listener);
    };
  }

  dispose(): void {
    this.listeners.clear();
  }
}

type WebTrackerState = {
  watchId: number | null;
  deliveryId: string | null;
  previous: PreviousSent | null;
  queue: GeoFix[];
  status: NativeTrackingStatus;
  listeners: Set<StatusListener>;
  active: boolean;
};

class WebTrackingController implements TrackingController {
  readonly native = false;
  private state: WebTrackerState = {
    watchId: null,
    deliveryId: null,
    previous: null,
    queue: [],
    status: { ...emptyStatus(), state: "idle", message: "Modo navegador: sem serviço nativo." },
    listeners: new Set(),
    active: false,
  };

  private emit(patch: Partial<NativeTrackingStatus> = {}): NativeTrackingStatus {
    this.state.status = { ...this.state.status, ...patch };
    const snapshot = { ...this.state.status };
    this.state.listeners.forEach((listener) => listener(snapshot));
    return snapshot;
  }

  private enqueue(fix: GeoFix): void {
    const now = Date.now();
    this.state.queue = this.state.queue
      .filter((item) => now - item.recordedAt <= TRACKING_POLICY.queueMaxAgeMs)
      .slice(-(TRACKING_POLICY.maxQueueSize - 1));
    this.state.queue.push(fix);
    this.emit({ queued: this.state.queue.length });
  }

  private async flushQueue(): Promise<boolean> {
    if (!this.state.deliveryId || !navigator.onLine) {
      return false;
    }

    while (this.state.queue.length > 0) {
      const fix = this.state.queue[0];

      if (!fix) {
        break;
      }

      try {
        await shareDeliveryLocation(
          this.state.deliveryId,
          fix.latitude,
          fix.longitude,
          fix.accuracyMeters,
          new Date(fix.recordedAt).toISOString(),
        );
        this.state.queue.shift();
        this.state.previous = {
          latitude: fix.latitude,
          longitude: fix.longitude,
          sentAt: Date.now(),
        };
        this.emit({
          queued: this.state.queue.length,
          state: "tracking",
          message: null,
          lastSentAt: Date.now(),
          lastLatitude: fix.latitude,
          lastLongitude: fix.longitude,
          lastAccuracy: fix.accuracyMeters,
          sentCount: this.state.status.sentCount + 1,
        });
      } catch {
        this.emit({ state: "offline", message: "Sem conexão. Amostras ficam na fila." });
        return false;
      }
    }

    return true;
  }

  private async handleFix(fix: GeoFix): Promise<void> {
    if (!this.state.active || !this.state.deliveryId) {
      return;
    }

    if (!isUsableFix(fix)) {
      this.emit({ message: "Precisão do GPS insuficiente. Aguardando sinal melhor." });
      return;
    }

    await this.flushQueue();

    const decision = decideSend(this.state.previous, fix, Date.now());

    if (!decision.send) {
      return;
    }

    try {
      await shareDeliveryLocation(
        this.state.deliveryId,
        fix.latitude,
        fix.longitude,
        fix.accuracyMeters,
        new Date(fix.recordedAt).toISOString(),
      );
      this.state.previous = {
        latitude: fix.latitude,
        longitude: fix.longitude,
        sentAt: Date.now(),
      };
      this.emit({
        state: "tracking",
        message: "Compartilhando enquanto a tela estiver ativa.",
        lastSentAt: Date.now(),
        lastLatitude: fix.latitude,
        lastLongitude: fix.longitude,
        lastAccuracy: fix.accuracyMeters,
        sentCount: this.state.status.sentCount + 1,
      });
    } catch {
      this.enqueue(fix);
      this.emit({ state: "offline", message: "Sem conexão. Amostras ficam na fila." });
    }
  }

  async start(options: StartTrackingOptions): Promise<NativeTrackingStatus> {
    if (!("geolocation" in navigator)) {
      throw new Error("Este navegador não oferece geolocalização.");
    }

    const session = await getTrackingSession();

    if (!session) {
      throw new Error("Sua sessão expirou. Entre novamente.");
    }

    await this.stop();
    this.state.deliveryId = options.deliveryId;
    this.state.active = true;
    this.state.previous = null;
    this.state.queue = [];
    this.emit({
      running: true,
      deliveryId: options.deliveryId,
      state: "starting",
      message: "Solicitando permissão de localização…",
      queued: 0,
      sentCount: 0,
    });

    this.state.watchId = navigator.geolocation.watchPosition(
      (position) => {
        void this.handleFix({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracyMeters: position.coords.accuracy,
          recordedAt: position.timestamp || Date.now(),
        });
      },
      (error) => {
        if (error.code === error.PERMISSION_DENIED) {
          this.emit({
            state: "error",
            running: false,
            message: "Permissão de localização negada. Libere nas configurações do navegador.",
          });
          this.stopWatch();
          return;
        }

        this.emit({
          state: "offline",
          message:
            error.code === error.TIMEOUT
              ? "Sem sinal de GPS. Tentando novamente…"
              : "Localização indisponível no momento.",
        });
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20_000 },
    );

    return this.emit();
  }

  private stopWatch(): void {
    if (this.state.watchId !== null) {
      navigator.geolocation.clearWatch(this.state.watchId);
      this.state.watchId = null;
    }
  }

  async stop(): Promise<NativeTrackingStatus> {
    this.state.active = false;
    this.stopWatch();
    this.state.queue = [];
    this.state.deliveryId = null;
    this.state.previous = null;
    return this.emit({
      running: false,
      deliveryId: null,
      state: "stopped",
      message: null,
      queued: 0,
    });
  }

  async getStatus(): Promise<NativeTrackingStatus> {
    return { ...this.state.status };
  }

  async requestNotificationPermission(): Promise<boolean> {
    return false;
  }

  subscribe(listener: StatusListener): () => void {
    this.state.listeners.add(listener);
    listener({ ...this.state.status });
    return () => {
      this.state.listeners.delete(listener);
    };
  }
}

let controller: TrackingController | null = null;

export function getTrackingController(): TrackingController {
  if (!controller) {
    controller = isNativeRuntime() ? new NativeTrackingController() : new WebTrackingController();
  }

  return controller;
}

export function describeStatus(status: TrackingStatus): string {
  switch (status.state) {
    case "idle":
      return "Localização não compartilhada.";
    case "starting":
      return "Iniciando o serviço de localização…";
    case "tracking":
      return status.message ?? "Compartilhando localização.";
    case "offline":
      return status.message ?? "Sem conexão. Amostras ficam na fila.";
    case "error":
      return status.message ?? "Falha no compartilhamento.";
    case "stopped":
      return "Compartilhamento encerrado.";
    default:
      return status.message ?? "";
  }
}
