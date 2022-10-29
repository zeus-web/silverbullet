#!/bin/bash

rm -rf website_build
npx --yes @silverbulletmd/publish -o website_build --index website

echo "Now building Silver Bullet bundle"
curl -fsSL https://deno.land/install.sh | sh
export PATH=~/.deno/bin:$PATH
deno task build
deno task bundle
cp dist/silverbullet.js website_build/silverbullet.js