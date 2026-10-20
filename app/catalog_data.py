"""Каталог комплектующих. Редактируй здесь: добавляй позиции, меняй характеристики.

ref_price — ориентировочная цена в рублях. Она показывается, пока нет свежей цены из магазинов
(см. app/prices.py). Цвета записаны как 0xRRGGBB и нужны только для 3D-модели.
"""

CATEGORIES = [
    ("case", "Корпус"),
    ("cpu", "Процессор"),
    ("mb", "Материнская плата"),
    ("cooler", "Охлаждение"),
    ("ram", "Оперативная память"),
    ("gpu", "Видеокарта"),
    ("ssd", "Накопитель"),
    ("psu", "Блок питания"),
]

PARTS: dict[str, list[dict]] = {
    "case": [
        {"id": "ch360", "name": "DeepCool CH360", "ref_price": 6000, "forms": ["mATX", "ITX"], "gpuMax": 320, "coolerMax": 165, "radTop": 240, "radFront": 360, "psu": "ATX", "dims": [215, 430, 410], "style": "mesh", "perf": "hex", "slots": 5, "fans": {"front": [3, 12], "rear": [1, 12]}, "rgbFans": True, "fansIncluded": True},
        {"id": "cc560", "name": "DeepCool CC560 V2", "ref_price": 5500, "forms": ["ATX", "mATX", "ITX"], "gpuMax": 370, "coolerMax": 163, "radTop": 240, "radFront": 360, "psu": "ATX", "dims": [210, 477, 416], "style": "mesh", "perf": "round", "slots": 7, "fans": {"front": [3, 12], "rear": [1, 12]}, "rgbFans": True, "fansIncluded": True},
        {"id": "lancool216", "name": "Lian Li Lancool 216", "ref_price": 9000, "forms": ["ATX", "mATX", "ITX"], "gpuMax": 392, "coolerMax": 180, "radTop": 360, "radFront": 360, "psu": "ATX", "dims": [235, 491, 480], "style": "mesh", "perf": "round", "slots": 7, "fans": {"front": [2, 16], "rear": [1, 14]}, "rgbFans": True, "fansIncluded": True},
        {"id": "north", "name": "Fractal Design North", "ref_price": 14500, "forms": ["ATX", "mATX", "ITX"], "gpuMax": 355, "coolerMax": 170, "radTop": 240, "radFront": 360, "psu": "ATX", "dims": [215, 469, 447], "style": "mesh", "perf": "slot", "slots": 7, "fans": {"front": [2, 14], "rear": [1, 14]}, "rgbFans": False, "fansIncluded": True},
        {"id": "o11evo", "name": "Lian Li O11 Dynamic EVO", "ref_price": 16000, "forms": ["ATX", "mATX", "ITX"], "gpuMax": 422, "coolerMax": 167, "radTop": 360, "radFront": 360, "psu": "ATX", "dims": [285, 465, 459], "style": "panorama", "perf": "slot", "slots": 7, "fans": {"bottom": [3, 12], "rear": [1, 12]}, "rgbFans": True, "fansIncluded": False},
        {"id": "nr200p", "name": "Cooler Master NR200P", "ref_price": 9500, "forms": ["ITX"], "gpuMax": 330, "coolerMax": 155, "radTop": 280, "radFront": 0, "psu": "SFX", "dims": [185, 292, 376], "style": "itx", "perf": "fine", "slots": 3, "fans": {"bottom": [2, 12]}, "rgbFans": False, "fansIncluded": True},
    ],
    "cpu": [
        {"id": "r5-5600", "name": "AMD Ryzen 5 5600", "ref_price": 9000, "socket": "AM4", "cores": 6, "threads": 12, "clock": "до 4,4 ГГц", "power": 76, "igpu": False, "tier": 1},
        {"id": "i5-12400f", "name": "Intel Core i5-12400F", "ref_price": 9500, "socket": "LGA1700", "cores": 6, "threads": 12, "clock": "до 4,4 ГГц", "power": 117, "igpu": False, "tier": 1},
        {"id": "r5-7500f", "name": "AMD Ryzen 5 7500F", "ref_price": 13000, "socket": "AM5", "cores": 6, "threads": 12, "clock": "до 5,0 ГГц", "power": 88, "igpu": False, "tier": 2},
        {"id": "i5-14600kf", "name": "Intel Core i5-14600KF", "ref_price": 20000, "socket": "LGA1700", "cores": 14, "threads": 20, "clock": "до 5,3 ГГц", "power": 181, "igpu": False, "tier": 3},
        {"id": "u7-265k", "name": "Intel Core Ultra 7 265K", "ref_price": 32000, "socket": "LGA1851", "cores": 20, "threads": 20, "clock": "до 5,5 ГГц", "power": 250, "igpu": True, "tier": 3},
        {"id": "r7-7800x3d", "name": "AMD Ryzen 7 7800X3D", "ref_price": 38000, "socket": "AM5", "cores": 8, "threads": 16, "clock": "до 5,0 ГГц", "power": 120, "igpu": True, "tier": 4},
        {"id": "r7-9800x3d", "name": "AMD Ryzen 7 9800X3D", "ref_price": 50000, "socket": "AM5", "cores": 8, "threads": 16, "clock": "до 5,2 ГГц", "power": 150, "igpu": True, "tier": 5},
    ],
    "mb": [
        {"id": "b550m", "name": "MSI B550M PRO-VDH", "ref_price": 8500, "socket": "AM4", "form": "mATX", "ram": "DDR4", "slots": 4, "pcb": 0x1c1e22, "acc": 0x8f969f},
        {"id": "b760m-d4", "name": "MSI PRO B760M-A DDR4", "ref_price": 11000, "socket": "LGA1700", "form": "mATX", "ram": "DDR4", "slots": 4, "pcb": 0x1c1e22, "acc": 0xa4abb3},
        {"id": "b650-eagle", "name": "Gigabyte B650 EAGLE AX", "ref_price": 16000, "socket": "AM5", "form": "ATX", "ram": "DDR5", "slots": 4, "pcb": 0x22252a, "acc": 0x6c737c},
        {"id": "b650i", "name": "ASUS ROG STRIX B650-I GAMING WIFI", "ref_price": 25000, "socket": "AM5", "form": "ITX", "ram": "DDR5", "slots": 2, "pcb": 0x141519, "acc": 0x2e323a, "rgbIO": True},
        {"id": "z790-tomahawk", "name": "MSI MAG Z790 TOMAHAWK WIFI", "ref_price": 26000, "socket": "LGA1700", "form": "ATX", "ram": "DDR5", "slots": 4, "pcb": 0x1a1c1f, "acc": 0x575c63},
        {"id": "z890-tuf", "name": "ASUS TUF GAMING Z890-PLUS WIFI", "ref_price": 30000, "socket": "LGA1851", "form": "ATX", "ram": "DDR5", "slots": 4, "pcb": 0x1d1f22, "acc": 0x8a7a45},
        {"id": "x870e-elite", "name": "Gigabyte X870E AORUS ELITE WIFI7", "ref_price": 33000, "socket": "AM5", "form": "ATX", "ram": "DDR5", "slots": 4, "pcb": 0x17181b, "acc": 0x9da3ab, "rgbIO": True},
    ],
    "cooler": [
        {"id": "is55", "name": "ID-Cooling IS-55", "ref_price": 3000, "type": "low", "height": 57, "tdp": 130, "pipes": 5},
        {"id": "ak400", "name": "DeepCool AK400", "ref_price": 2800, "type": "tower", "towers": 1, "height": 155, "tdp": 220, "pipes": 4, "fan": 12, "cap": 0x1a1b1e},
        {"id": "pa120", "name": "Thermalright Peerless Assassin 120 SE", "ref_price": 3800, "type": "tower", "towers": 2, "height": 155, "tdp": 245, "pipes": 6, "fan": 12, "cap": 0x26282c},
        {"id": "nhd15", "name": "Noctua NH-D15", "ref_price": 13000, "type": "tower", "towers": 2, "height": 165, "tdp": 250, "pipes": 6, "fan": 14, "cap": 0x8e939a},
        {"id": "lf3-240", "name": "ARCTIC Liquid Freezer III 240", "ref_price": 8000, "type": "aio", "rad": 240, "tdp": 270},
        {"id": "ls720", "name": "DeepCool LS720", "ref_price": 11000, "type": "aio", "rad": 360, "tdp": 300},
    ],
    "ram": [
        {"id": "d4-2x8", "name": "Kingston FURY Beast DDR4 2×8 ГБ", "ref_price": 3500, "type": "DDR4", "sticks": 2, "size": 16, "speed": "3200 МТ/с", "rgb": False, "color": 0x1e1f23, "profile": "stepped"},
        {"id": "d4-2x16", "name": "Kingston FURY Beast DDR4 2×16 ГБ", "ref_price": 6500, "type": "DDR4", "sticks": 2, "size": 32, "speed": "3600 МТ/с", "rgb": False, "color": 0x1e1f23, "profile": "stepped"},
        {"id": "d5-2x16", "name": "G.Skill Flare X5 DDR5 2×16 ГБ", "ref_price": 10000, "type": "DDR5", "sticks": 2, "size": 32, "speed": "6000 МТ/с, CL30", "rgb": False, "color": 0x17181a, "profile": "flat"},
        {"id": "d5-2x16-rgb", "name": "Kingston FURY Beast RGB DDR5 2×16 ГБ", "ref_price": 11000, "type": "DDR5", "sticks": 2, "size": 32, "speed": "6000 МТ/с", "rgb": True, "color": 0x1e1f23, "profile": "stepped"},
        {"id": "d5-4x16", "name": "Kingston FURY Beast DDR5 4×16 ГБ", "ref_price": 20000, "type": "DDR5", "sticks": 4, "size": 64, "speed": "5600 МТ/с", "rgb": False, "color": 0x1e1f23, "profile": "stepped"},
        {"id": "d5-2x32-rgb", "name": "G.Skill Trident Z5 RGB DDR5 2×32 ГБ", "ref_price": 22000, "type": "DDR5", "sticks": 2, "size": 64, "speed": "6400 МТ/с", "rgb": True, "color": 0xb7bcc3, "profile": "tall"},
    ],
    "gpu": [
        {"id": "none", "name": "Без видеокарты", "ref_price": 0, "power": 0, "length": 0, "tier": 0},
        {"id": "5060", "name": "Palit GeForce RTX 5060 Dual 8 ГБ", "ref_price": 33000, "label": "RTX 5060", "vendor": "nv", "power": 145, "length": 250, "slots": 2, "fans": 2, "vram": 8, "tier": 1, "psuRec": 550, "conn": "8-pin", "body": 0x2b2d31, "acc": 0x8c939c},
        {"id": "9060xt", "name": "Sapphire PULSE Radeon RX 9060 XT 16 ГБ", "ref_price": 40000, "label": "RX 9060 XT", "vendor": "amd", "power": 160, "length": 240, "slots": 2, "fans": 2, "vram": 16, "tier": 2, "psuRec": 500, "conn": "8-pin", "body": 0x26282c, "acc": 0xc8202f},
        {"id": "5060ti", "name": "MSI GeForce RTX 5060 Ti Ventus 2X 16 ГБ", "ref_price": 48000, "label": "RTX 5060 Ti", "vendor": "nv", "power": 180, "length": 200, "slots": 2, "fans": 2, "vram": 16, "tier": 2, "psuRec": 600, "conn": "8-pin", "body": 0x3a3d42, "acc": 0x9aa0a8},
        {"id": "5070", "name": "Gigabyte GeForce RTX 5070 WINDFORCE 12 ГБ", "ref_price": 62000, "label": "RTX 5070", "vendor": "nv", "power": 250, "length": 282, "slots": 2.5, "fans": 3, "vram": 12, "tier": 3, "psuRec": 650, "conn": "16-pin", "body": 0x1f2124, "acc": 0x5a6068},
        {"id": "9070xt", "name": "Sapphire PULSE Radeon RX 9070 XT 16 ГБ", "ref_price": 75000, "label": "RX 9070 XT", "vendor": "amd", "power": 304, "length": 280, "slots": 2.8, "fans": 3, "vram": 16, "tier": 4, "psuRec": 750, "conn": "2×8-pin", "body": 0x26282c, "acc": 0xc8202f},
        {"id": "5070ti", "name": "ASUS TUF GeForce RTX 5070 Ti 16 ГБ", "ref_price": 100000, "label": "RTX 5070 Ti", "vendor": "nv", "power": 300, "length": 327, "slots": 3.2, "fans": 3, "vram": 16, "tier": 4, "psuRec": 750, "conn": "16-pin", "body": 0x3b3e43, "acc": 0xa8955a},
        {"id": "5080", "name": "MSI GeForce RTX 5080 GAMING TRIO 16 ГБ", "ref_price": 135000, "label": "RTX 5080", "vendor": "nv", "power": 360, "length": 338, "slots": 3, "fans": 3, "vram": 16, "tier": 5, "psuRec": 850, "conn": "16-pin", "body": 0x1c1d20, "acc": "rgb"},
    ],
    "ssd": [
        {"id": "nv3-1", "name": "Kingston NV3 1 ТБ", "ref_price": 6000, "cap": "1 ТБ", "iface": "PCIe 4.0", "speed": "6000 МБ/с"},
        {"id": "990evo-1", "name": "Samsung 990 EVO Plus 1 ТБ", "ref_price": 9000, "cap": "1 ТБ", "iface": "PCIe 4.0", "speed": "7150 МБ/с"},
        {"id": "sn850x-2", "name": "WD_BLACK SN850X 2 ТБ", "ref_price": 16000, "cap": "2 ТБ", "iface": "PCIe 4.0", "speed": "7300 МБ/с"},
        {"id": "990pro-2", "name": "Samsung 990 PRO 2 ТБ", "ref_price": 19000, "cap": "2 ТБ", "iface": "PCIe 4.0", "speed": "7450 МБ/с"},
    ],
    "psu": [
        {"id": "pk550d", "name": "DeepCool PK550D", "ref_price": 4500, "watt": 550, "cert": "80+ Bronze", "form": "ATX", "modular": False, "native16": False},
        {"id": "a650bn", "name": "MSI MAG A650BN", "ref_price": 5500, "watt": 650, "cert": "80+ Bronze", "form": "ATX", "modular": False, "native16": False},
        {"id": "pn750m", "name": "DeepCool PN750M", "ref_price": 8500, "watt": 750, "cert": "80+ Gold", "form": "ATX", "modular": True, "native16": True},
        {"id": "pp12m-850", "name": "be quiet! Pure Power 12 M 850W", "ref_price": 12500, "watt": 850, "cert": "80+ Gold", "form": "ATX", "modular": True, "native16": True},
        {"id": "gx1000", "name": "Seasonic FOCUS GX-1000 ATX 3.0", "ref_price": 17000, "watt": 1000, "cert": "80+ Gold", "form": "ATX", "modular": True, "native16": True},
        {"id": "sf750", "name": "Corsair SF750", "ref_price": 17000, "watt": 750, "cert": "80+ Platinum", "form": "SFX", "modular": True, "native16": True},
    ],
}

PRESETS = [
    {"id": "budget", "label": "Бюджет", "color": "black",
     "sel": {"case": "ch360", "cpu": "r5-5600", "mb": "b550m", "cooler": "ak400", "ram": "d4-2x16", "gpu": "5060", "ssd": "nv3-1", "psu": "a650bn"}},
    {"id": "game", "label": "Игровая", "color": "black",
     "sel": {"case": "lancool216", "cpu": "r5-7500f", "mb": "b650-eagle", "cooler": "pa120", "ram": "d5-2x16", "gpu": "5070", "ssd": "990evo-1", "psu": "pn750m"}},
    {"id": "itx", "label": "Мини", "color": "white",
     "sel": {"case": "nr200p", "cpu": "r7-7800x3d", "mb": "b650i", "cooler": "is55", "ram": "d5-2x16", "gpu": "5070", "ssd": "sn850x-2", "psu": "sf750"}},
    {"id": "top", "label": "Максимум", "color": "white",
     "sel": {"case": "o11evo", "cpu": "r7-9800x3d", "mb": "x870e-elite", "cooler": "ls720", "ram": "d5-2x32-rgb", "gpu": "5080", "ssd": "990pro-2", "psu": "gx1000"}},
]

RGB_OPTIONS = [
    {"v": "off", "name": "Выключить"},
    {"v": "#ffffff", "name": "Белый"},
    {"v": "#ff7a2f", "name": "Медный"},
    {"v": "#29d3ff", "name": "Голубой"},
    {"v": "#b44dff", "name": "Фиолетовый"},
    {"v": "#36f58a", "name": "Зелёный"},
    {"v": "rainbow", "name": "Радуга"},
]

TIERS = [
    "Офис, учёба и видео",
    "1080p на высоких",
    "1080p ультра, 1440p средние",
    "1440p на высоких",
    "1440p ультра, 4K средние",
    "4K на высоких",
]
