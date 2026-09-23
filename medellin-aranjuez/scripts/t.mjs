import { chromium } from '@playwright/test';
console.log('launching');
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
console.log('launched');
const page = await browser.newPage();
await page.setContent('<canvas id=c></canvas><script>const gl=document.getElementById("c").getContext("webgl2");document.title=gl?gl.getParameter(gl.RENDERER):"nogl"</script>');
console.log(await page.title());
await browser.close();
