import { create } from 'zustand';
import * as devicesApi from '../api/devices';

/**
 * Device inventory.
 *
 * Devices are the navigation unit of the product: every page either lists them
 * or reads one of them. Keeping them in a store means the live socket feed and
 * the REST reads update the same objects (status, lastSeenAt) exactly once.
 */
export const useDeviceStore = create((set, get) => ({
  devices: [],
  meta: null,
  loading: false,
  error: null,

  async load(params = {}) {
    set({ loading: true, error: null });
    try {
      const { devices, meta } = await devicesApi.listDevices(params);
      set({ devices, meta, loading: false });
      return devices;
    } catch (error) {
      set({ loading: false, error: error.message });
      throw error;
    }
  },

  async claim(deviceId, claimCode) {
    const device = await devicesApi.claimDevice(deviceId, claimCode);
    set({ devices: [device, ...get().devices.filter((d) => d.deviceId !== device.deviceId)] });
    return device;
  },

  async patch(deviceId, patch) {
    const device = await devicesApi.updateDevice(deviceId, patch);
    set({ devices: get().devices.map((d) => (d.deviceId === deviceId ? device : d)) });
    return device;
  },

  /** Replace one device without a round trip (used by socket `device:*` events). */
  upsert(device) {
    set({ devices: [device, ...get().devices.filter((d) => d.deviceId !== device.deviceId)] });
  },

  /** Merge partial fields (used by telemetry heartbeats: lastSeenAt, status). */
  merge(deviceId, fields) {
    set({
      devices: get().devices.map((d) => (d.deviceId === deviceId ? { ...d, ...fields } : d)),
    });
  },

  remove(deviceId) {
    set({ devices: get().devices.filter((d) => d.deviceId !== deviceId) });
  },

  reset() {
    set({ devices: [], meta: null, loading: false, error: null });
  },
}));
