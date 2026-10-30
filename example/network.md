# Example house network

A made-up house for the bundled example. The atlas reads the four sections below; anything
else in the file, like this paragraph, is ignored.

## Addresses

| Address | Device | MAC | How it's held |
| --- | --- | --- | --- |
| 192.168.50.1 | Mesh router | 02:00:00:00:00:01 | the router itself |
| 192.168.50.10 | NAS | 02:00:00:00:00:10 | reservation |
| 192.168.50.11 | Mini PC | 02:00:00:00:00:11 | reservation |
| 192.168.50.20 | Den satellite | 02:00:00:00:00:20 | reservation |
| 192.168.50.30 | Laptop | 02:00:00:00:00:30 | DHCP |
| 192.168.50.40 | Printer | 02:00:00:00:00:40 | reservation |
| 192.168.50.50 | Den TV | 02:00:00:00:00:50 | DHCP |

## Measured

| Path | Result |
| --- | --- |
| Mini PC to NAS, storage link | 2.3 Gbit/s |
| Laptop to NAS on 5 GHz | 610 Mbit/s |
| Den satellite backhaul over MoCA | 940 Mbit/s |

## Decided

- **The NAS keeps the media.** Anything whose working set is the disk array stays on it.
- **Satellites ride MoCA.** Wireless backhaul is the fallback, not the plan.

## Open work

- [ ] Put the mini PC on the UPS.
- [ ] Move the printer off 2.4 GHz.
