import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Geolocation } from "@capacitor/geolocation";
import { Network } from "@capacitor/network";

import { DeliveriesScreen } from "./components/DeliveriesScreen";
import { DeliveryDetail } from "./components/DeliveryDetail";
import { LoginScreen } from "./components/LoginScreen";
import { StorePicker } from "./components/StorePicker";
import {
  clearDeliveryLocation,
  completeDelivery,
  getSession,
  listDriverDeliveries,
  listDriverStores,
  signOut,
  startDelivery,
} from "./lib/api";
import { isActiveDelivery } from "./lib/delivery";
import { hasSupabaseConfig } from "./lib/env";
import { getSupabase } from "./lib/supabase";
import { emptyStatus, getTrackingController } from "./lib/tracker";
import type { DriverDelivery, DriverStore, TrackingStatus } from "./lib/types";

const REFRESH_INTERVAL_MS = 30_000;

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : "Não foi possível concluir a ação.";
}

export function App() {
  const [booting, setBooting] = useState(true);
  const [email, setEmail] = useState<string | null>(null);
  const [stores, setStores] = useState<DriverStore[]>([]);
  const [storesLoading, setStoresLoading] = useState(false);
  const [storesError, setStoresError] = useState<string | null>(null);
  const [store, setStore] = useState<DriverStore | null>(null);
  const [deliveries, setDeliveries] = useState<DriverDelivery[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"active" | "history">("active");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<TrackingStatus>(emptyStatus);
  const [permission, setPermission] = useState<string | null>(null);
  const [online, setOnline] = useState(() => navigator.onLine);

  const controller = useMemo(() => getTrackingController(), []);
  const native = controller.native;
  const storeRef = useRef<DriverStore | null>(null);
  storeRef.current = store;

  const loadStores = useCallback(async () => {
    setStoresLoading(true);
    setStoresError(null);

    try {
      const list = await listDriverStores();
      setStores(list);
    } catch (caught) {
      setStoresError(messageOf(caught));
    } finally {
      setStoresLoading(false);
    }
  }, []);

  const loadDeliveries = useCallback(async (target: DriverStore) => {
    setLoading(true);

    try {
      const list = await listDriverDeliveries(target.storeId);

      if (storeRef.current?.storeId === target.storeId) {
        setDeliveries(list);
        setError(null);
      }
    } catch (caught) {
      if (storeRef.current?.storeId === target.storeId) {
        setError(messageOf(caught));
      }
    } finally {
      if (storeRef.current?.storeId === target.storeId) {
        setLoading(false);
      }
    }
  }, []);

  const refreshPermission = useCallback(async () => {
    if (!native) {
      try {
        const result = await navigator.permissions?.query({ name: "geolocation" });
        setPermission(result ? result.state : null);
      } catch {
        setPermission(null);
      }
      return;
    }

    try {
      const result = await Geolocation.checkPermissions();
      setPermission(result.location ?? result.coarseLocation ?? null);
    } catch {
      setPermission(null);
    }
  }, [native]);

  useEffect(() => {
    if (!hasSupabaseConfig()) {
      setBooting(false);
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const session = await getSession();

        if (!cancelled && session?.user) {
          setEmail(session.user.email ?? "");
          await loadStores();
        }
      } catch {
        // A missing or expired session falls back to the login screen.
      } finally {
        if (!cancelled) {
          setBooting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [loadStores]);

  useEffect(() => {
    if (!hasSupabaseConfig()) {
      return;
    }

    const { data } = getSupabase().auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") {
        setEmail(null);
        setStore(null);
        setStores([]);
        setDeliveries([]);
        setSelectedId(null);
      }
    });

    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    const unsubscribe = controller.subscribe((status) => {
      setTracking(status);
    });

    return unsubscribe;
  }, [controller]);

  useEffect(() => {
    void refreshPermission();
  }, [refreshPermission]);

  useEffect(() => {
    if (!native) {
      return;
    }

    let handle: { remove: () => Promise<void> } | null = null;
    let cancelled = false;

    void Network.addListener("networkStatusChange", (status) => {
      setOnline(status.connected);
    }).then((listener) => {
      if (cancelled) {
        void listener.remove();
      } else {
        handle = listener;
      }
    });

    return () => {
      cancelled = true;
      void handle?.remove();
    };
  }, [native]);

  useEffect(() => {
    if (!store) {
      return;
    }

    const target = store;
    setSelectedId(null);
    void loadDeliveries(target);

    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") {
        void loadDeliveries(target);
      }
    }, REFRESH_INTERVAL_MS);

    const onFocus = () => {
      void loadDeliveries(target);
      void refreshPermission();
      void controller
        .getStatus()
        .then((status) => setTracking(status))
        .catch(() => undefined);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onFocus);

    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [store, loadDeliveries, refreshPermission, controller]);

  const activeDeliveries = useMemo(
    () => deliveries.filter((item) => isActiveDelivery(item.delivery.status)),
    [deliveries],
  );

  const historyDeliveries = useMemo(
    () => deliveries.filter((item) => !isActiveDelivery(item.delivery.status)),
    [deliveries],
  );

  const visibleDeliveries = tab === "active" ? activeDeliveries : historyDeliveries;
  const selected = deliveries.find((item) => item.delivery.id === selectedId) ?? null;

  useEffect(() => {
    if (!tracking.running || !tracking.deliveryId) {
      return;
    }

    const stillActive = deliveries.some(
      (item) => item.delivery.id === tracking.deliveryId && isActiveDelivery(item.delivery.status),
    );

    if (deliveries.length > 0 && !stillActive) {
      void controller.stop().catch(() => undefined);
    }
  }, [deliveries, tracking.running, tracking.deliveryId, controller]);

  const runAction = useCallback(async (action: () => Promise<void>) => {
    setBusy(true);
    setActionError(null);

    try {
      await action();
    } catch (caught) {
      setActionError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  }, []);

  const handleStartDelivery = useCallback(
    (item: DriverDelivery) => {
      const target = storeRef.current;

      if (!target) {
        return;
      }

      void runAction(async () => {
        await startDelivery(item.delivery.id);
        await loadDeliveries(target);
      });
    },
    [loadDeliveries, runAction],
  );

  const handleCompleteDelivery = useCallback(
    (item: DriverDelivery) => {
      const target = storeRef.current;

      if (!target) {
        return;
      }

      void runAction(async () => {
        if (tracking.running && tracking.deliveryId === item.delivery.id) {
          await controller.stop().catch(() => undefined);
        }

        await clearDeliveryLocation(item.delivery.id).catch(() => undefined);
        await completeDelivery(item.delivery.id);
        await loadDeliveries(target);
      });
    },
    [controller, loadDeliveries, runAction, tracking.deliveryId, tracking.running],
  );

  const handleStartTracking = useCallback(
    (item: DriverDelivery) => {
      void runAction(async () => {
        if (native) {
          const result = await Geolocation.requestPermissions({ permissions: ["location"] });
          const state = result.location ?? result.coarseLocation ?? "denied";
          setPermission(state);

          if (state !== "granted") {
            throw new Error(
              "Permissão de localização negada. Autorize o acesso nas configurações do Android.",
            );
          }

          await controller.requestNotificationPermission().catch(() => false);
        }

        const status = await controller.start({ deliveryId: item.delivery.id });
        setTracking(status);
        void refreshPermission();
      });
    },
    [controller, native, refreshPermission, runAction],
  );

  const handleStopTracking = useCallback(() => {
    const deliveryId = tracking.deliveryId;

    void runAction(async () => {
      const status = await controller.stop();
      setTracking(status);

      if (deliveryId) {
        await clearDeliveryLocation(deliveryId).catch(() => undefined);
      }
    });
  }, [controller, runAction, tracking.deliveryId]);

  const handleSignOut = useCallback(() => {
    void (async () => {
      if (tracking.running) {
        const deliveryId = tracking.deliveryId;
        await controller.stop().catch(() => undefined);

        if (deliveryId) {
          await clearDeliveryLocation(deliveryId).catch(() => undefined);
        }
      }

      await signOut().catch(() => undefined);
      setEmail(null);
      setStore(null);
      setStores([]);
      setDeliveries([]);
      setSelectedId(null);
      setTab("active");
    })();
  }, [controller, tracking.deliveryId, tracking.running]);

  const handleChangeStore = useCallback(() => {
    if (tracking.running) {
      setActionError("Pare o compartilhamento de localização antes de trocar de loja.");
      return;
    }

    setStore(null);
    setDeliveries([]);
    setError(null);
    setActionError(null);
  }, [tracking.running]);

  const handleSelectStore = useCallback((target: DriverStore) => {
    setStore(target);
    setActionError(null);
    setError(null);
    setTab("active");
  }, []);

  if (booting) {
    return (
      <main className="screen splash">
        <span className="brand-mark">AV</span>
        <p>Carregando…</p>
      </main>
    );
  }

  if (!email) {
    return (
      <LoginScreen
        onSignedIn={() => {
          void (async () => {
            const session = await getSession();
            setEmail(session?.user?.email ?? "");
            await loadStores();
          })();
        }}
      />
    );
  }

  if (!store) {
    return (
      <StorePicker
        stores={stores}
        displayName={stores.find((item) => item.displayName)?.displayName ?? null}
        error={storesError}
        onSelect={handleSelectStore}
        onSignOut={handleSignOut}
      />
    );
  }

  if (storesLoading && stores.length === 0) {
    return (
      <main className="screen splash">
        <p>Carregando lojas…</p>
      </main>
    );
  }

  if (selected) {
    return (
      <DeliveryDetail
        item={selected}
        native={native}
        tracking={tracking}
        locationPermission={permission}
        busy={busy}
        actionError={actionError}
        onBack={() => {
          setSelectedId(null);
          setActionError(null);
        }}
        onStartDelivery={() => handleStartDelivery(selected)}
        onCompleteDelivery={() => handleCompleteDelivery(selected)}
        onStartTracking={() => handleStartTracking(selected)}
        onStopTracking={handleStopTracking}
      />
    );
  }

  return (
    <DeliveriesScreen
      store={store}
      deliveries={visibleDeliveries}
      loading={loading}
      error={error}
      online={online}
      tab={tab}
      activeCount={activeDeliveries.length}
      onTab={setTab}
      onOpen={(item) => {
        setSelectedId(item.delivery.id);
        setActionError(null);
      }}
      onRefresh={() => void loadDeliveries(store)}
      onChangeStore={handleChangeStore}
      onSignOut={handleSignOut}
    />
  );
}
