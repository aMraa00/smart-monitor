import Card from '../components/Card';
import Badge from '../components/Badge';

/**
 * In-dashboard setup guide (P7 firmware bring-up).
 *
 * The content mirrors the README section of the same name. It is data, not
 * markup, so the whole flow stays readable in one place and every step is
 * ordered exactly as an operator performs it.
 */

const STEPS = [
  {
    title: '1. Flash the firmware',
    body: 'Connect the ESP32 over USB and build+upload from PlatformIO. The console runs at 115200 baud.',
    code: 'cd firmware/smart_monitor_v1\npio run -t upload\npio device monitor',
  },
  {
    title: '2. Join the access point',
    body: 'On first boot an open AP named SmartMonitor-XXXXXX appears. Connect a phone to it and open the captive page.',
    code: 'http://192.168.4.1',
  },
  {
    title: '3. Save network + server',
    body: 'Enter your home Wi-Fi (SSID + password) and the API endpoint. HTTPS in production, http://<lan-ip>:5000 for local testing.',
    code: 'API endpoint: https://<your-deployment>',
  },
  {
    title: '4. Read the claim code',
    body: 'The device registers itself and exchanges the provisioning token for its deviceId + secret (stored in NVS). A claim code is printed on the serial console.',
    code: 'type status   # serial: shows pending=<buffered samples>',
  },
  {
    title: '5. Claim it here',
    body: 'Open Devices -> Claim, type the device id and the claim code. The station then appears in your fleet.',
    code: null,
  },
];

/** Pin map, kept next to the guide so it is visible without opening config.h. */
const PINOUT = [
  ['DHT11', 'GPIO 4'],
  ['A3144 wind sensor', 'GPIO 16'],
  ['I2C (BMP180 / BH1750 / CCS811)', 'SDA 21 · SCL 22'],
  ['MicroSD', 'CS 5 · SCK 18 · MISO 19 · MOSI 23'],
  ['Boot button', 'GPIO 0'],
  ['Status LED', 'GPIO 2'],
];

export function GuidePage() {
  return (
    <>
      <header className="page-header">
        <div>
          <h1>Setup guide</h1>
          <p className="muted">Bring a new station online: flash, Wi-Fi, claim, watch it live.</p>
        </div>
      </header>

      {STEPS.map((step) => (
        <Card key={step.title} title={step.title} subtitle={step.body}>
          {step.code && <pre className="code-block">{step.code}</pre>}
        </Card>
      ))}

      <Card title="Pin map" subtitle="Defined once in config.h; shown here so wiring is checkable without a build.">
        <table className="table">
          <thead>
            <tr>
              <th>Peripheral</th>
              <th>GPIO</th>
            </tr>
          </thead>
          <tbody>
            {PINOUT.map(([peripheral, pin]) => (
              <tr key={peripheral}>
                <td>{peripheral}</td>
                <td>
                  <code>{pin}</code>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      <Card title="Good to know" subtitle="Design rules the firmware never bends.">
        <ul className="bullet-list">
          <li>
            <Badge tone="info">offline</Badge> Wi-Fi loss never loses data: samples are buffered on MicroSD and drained
            at-least-once (duplicates are removed server-side by sampleId).
          </li>
          <li>
            <Badge tone="warn">quality</Badge> A failing sensor is omitted from the sample instead of being reported as
            0, and the reading is marked with a quality flag.
          </li>
          <li>
            <Badge tone="neutral">identity</Badge> Factory reset wipes network settings but preserves device identity and
            its secret.
          </li>
        </ul>
      </Card>
    </>
  );
}

export default GuidePage;