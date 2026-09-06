// One-off placeholder icon generator (no image-processing dependency needed).
// Produces solid-color square PNGs for the PWA manifest until real branded icons
// are designed (see tasks.md T099).
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const CRC_TABLE = (() => {
	const t = new Uint32Array(256);
	for (let n = 0; n < 256; n++) {
		let c = n;
		for (let k = 0; k < 8; k++) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		t[n] = c >>> 0;
	}
	return t;
})();

function crc32(buf) {
	const table = CRC_TABLE;
	let crc = 0xffffffff;
	for (let i = 0; i < buf.length; i++) {
		crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
	}
	return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
	const typeBuf = Buffer.from(type, 'ascii');
	const lenBuf = Buffer.alloc(4);
	lenBuf.writeUInt32BE(data.length, 0);
	const crcBuf = Buffer.alloc(4);
	crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
	return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

function makeSolidPng(size, [r, g, b]) {
	const rowBytes = size * 3;
	const raw = Buffer.alloc((rowBytes + 1) * size);
	for (let y = 0; y < size; y++) {
		const rowStart = y * (rowBytes + 1);
		raw[rowStart] = 0; // filter type: none
		for (let x = 0; x < size; x++) {
			const o = rowStart + 1 + x * 3;
			raw[o] = r;
			raw[o + 1] = g;
			raw[o + 2] = b;
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(size, 0);
	ihdr.writeUInt32BE(size, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // color type: truecolor
	ihdr[10] = 0;
	ihdr[11] = 0;
	ihdr[12] = 0;
	const idat = zlib.deflateSync(raw);
	const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
	return Buffer.concat([
		signature,
		chunk('IHDR', ihdr),
		chunk('IDAT', idat),
		chunk('IEND', Buffer.alloc(0))
	]);
}

// Constitution/brand-neutral placeholder: a deep teal, evokes "trustworthy ledger".
const COLOR = [15, 118, 110];
const outDir = path.join(__dirname, '..', 'static', 'icons');
fs.mkdirSync(outDir, { recursive: true });
for (const size of [192, 512]) {
	const png = makeSolidPng(size, COLOR);
	fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
}
console.log('Placeholder icons written to static/icons/');
