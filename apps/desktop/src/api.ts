import { invoke } from "@tauri-apps/api/core";
import type { AndroidApp, AndroidDevice, HttpTransaction, ProxyStatus, QrPairingChallenge, QrPairingResult } from "./types";
const native = () => "__TAURI_INTERNALS__" in window;
export const discoverDevices = async (): Promise<AndroidDevice[]> => native() ? invoke("discover_devices") : [];
export const listInstalledApps = async (serial: string): Promise<AndroidApp[]> => invoke("list_installed_apps", { serial });
export const launchInstalledApp = async (serial: string, packageName: string): Promise<void> => invoke("launch_installed_app", { serial, packageName });
export const getProxyStatus = async (): Promise<ProxyStatus> => native() ? invoke("get_proxy_status") : "stopped";
export const startProxy = async (): Promise<string> => invoke("start_proxy");
export const stopProxy = async (): Promise<void> => invoke("stop_proxy");
export const generateCa = async (): Promise<{certificate_path:string;fingerprint_sha256:string}> => invoke("generate_ca_certificate");
export const configureAndroidProxy = async (serial:string, host:string,port:number):Promise<void> => invoke("configure_android_proxy",{serial,host,port});
export const clearAndroidProxy = async (serial:string):Promise<void> => invoke("clear_android_proxy",{serial});
export const listTransactions = async ():Promise<HttpTransaction[]> => native() ? invoke("list_transactions",{limit:250,offset:0}) : [];
export const beginQrPairing = async ():Promise<QrPairingChallenge> => invoke("begin_qr_pairing");
export const finishQrPairing = async (pairingId:string):Promise<QrPairingResult> => invoke("finish_qr_pairing",{pairingId});
export const pairWithCode = async (host:string, port:number, pairingCode:string):Promise<QrPairingResult> =>
  invoke("pair_with_code", { host, port, pairingCode });
export const enableUsbWifi = async (serial:string, port=5555):Promise<QrPairingResult> =>
  invoke("enable_usb_wifi", { serial, port });
