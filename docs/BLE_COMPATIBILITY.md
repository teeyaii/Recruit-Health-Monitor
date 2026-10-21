# BLE compatibility evidence — 21 October 2026

STEVE targets the Bluetooth Heart Rate Service (180D) / Heart Rate Measurement (2A37) notification interface. It parses UINT8 and little-endian UINT16 BPM and treats explicitly unavailable sensor contact as missing data. It does not implement proprietary Xiaomi authentication or read private Mi Fitness databases.

[Xiaomi's Smart Band 10 FAQ](https://www.mi.com/uk/support/faq/details/KA-579104/) confirms Bluetooth HR broadcast and describes enabling it on the band under Settings → Share HR → Turn on. This supports testing the standard-broadcast path; it does not prove interoperability with these STEVE apps or a particular firmware/region.

[Tnze/miband-heart-rate](https://github.com/Tnze/miband-heart-rate/blob/main/README.md) is an existing open-source research reference. No source has been copied. Older Mi Band techniques should not be assumed to apply to Band 10.

Other heart-rate straps/bands can be candidates if they advertise 180D and support notifications on 2A37. The current scan deliberately filters by 180D: devices that omit that advertisement will not appear. Check vendor broadcast settings and the actual GATT service with a diagnostic app before changing the filter.

Hardware acceptance is still open: real scan visibility, notification/flags, identity confirmation, disconnect/reconnect, 1/2/3 concurrent bands per phone, foreground/lock/background behavior, and range/interference. Discovery order is never a recruit identity. CI and simulator builds are not physical BLE tests.
