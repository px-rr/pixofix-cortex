Write-Host "=== Pixofix Cortex - Deployment Helper ===" -ForegroundColor Cyan
Write-Host ""
Write-Host "Your code is pushed to: https://github.com/px-rr/pixofix-cortex" -ForegroundColor Green
Write-Host ""
Write-Host "=== Option 1: Deploy on Render (recommended - backend + frontend together) ===" -ForegroundColor Yellow
Write-Host "1. Go to: https://dashboard.render.com/select-repo?name=pixofix-cortex" -ForegroundColor White
Write-Host "2. Sign up with GitHub and connect the repo" -ForegroundColor White
Write-Host "3. Configure:" -ForegroundColor White
Write-Host "   - Runtime: Node" -ForegroundColor White
Write-Host "   - Build Command: npm install" -ForegroundColor White
Write-Host "   - Start Command: node server.js" -ForegroundColor White
Write-Host "4. Click Create Web Service" -ForegroundColor White
Write-Host "5. Wait ~3 min for build & deploy" -ForegroundColor White
Write-Host "6. Open the URL (e.g. https://pixofix-cortex.onrender.com)" -ForegroundColor White
Write-Host "7. Login: 1101 / 1101 → set new password" -ForegroundColor Green
Write-Host ""
Write-Host "=== Option 2: Deploy on Vercel (frontend only) ===" -ForegroundColor Yellow
Write-Host "1. Go to: https://vercel.com/new/clone?repository-url=https://github.com/px-rr/pixofix-cortex" -ForegroundColor White
Write-Host "2. Import repo" -ForegroundColor White
Write-Host "3. Set Output Directory to: public" -ForegroundColor White
Write-Host "4. Deploy" -ForegroundColor White
Write-Host "5. Frontend works standalone with localStorage" -ForegroundColor White
Write-Host ""
Write-Host "=== Admin Account ===" -ForegroundColor Magenta
Write-Host "ID: 1101" -ForegroundColor White
Write-Host "Password: 1101" -ForegroundColor White
Write-Host "(Password change forced on first login)" -ForegroundColor White
Write-Host ""
Write-Host "=== IMAP Email Setup (after deployment) ===" -ForegroundColor Magenta
Write-Host 'curl -X POST https://your-app.onrender.com/api/imap-config ^' -ForegroundColor White
Write-Host '  -H "Content-Type: application/json" ^' -ForegroundColor White
Write-Host '  -d "{\"host\":\"imap.yourhost.com\",\"port\":993,\"user\":\"support@pixofix.com\",\"pass\":\"yourpassword\"}"' -ForegroundColor White
Write-Host ""
Write-Host "Press any key to open the GitHub repo in your browser..." -ForegroundColor Gray
$null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
Start-Process "https://github.com/px-rr/pixofix-cortex"
