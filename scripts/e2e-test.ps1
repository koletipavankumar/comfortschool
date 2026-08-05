# E2E test script for local Comfort Grammar School app
# Usage: powershell -File .\scripts\e2e-test.ps1

Remove-Item cookie.txt -ErrorAction SilentlyContinue
Remove-Item cookie2.txt -ErrorAction SilentlyContinue
Remove-Item test-image.png -ErrorAction SilentlyContinue

$base64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII='
[System.IO.File]::WriteAllBytes('test-image.png',[Convert]::FromBase64String($base64))
Write-Host 'Wrote test-image.png'

# helper to extract csrf from html
function Extract-CsrfFromHtml([string]$html) {
  if (-not $html) { return $null }
  $m = [regex]::Match($html, '<input type="hidden" name="_csrf" value="([^\"]+)"')
  if ($m.Success) { return $m.Groups[1].Value }
  return $null
}

# Login
$loginPage = curl.exe -s http://localhost:3000/admin/login -c cookie.txt
Write-Host "Login page length: $($loginPage.Length)"
$token = Extract-CsrfFromHtml $loginPage
if (-not $token) { Write-Host 'Unable to locate CSRF on login page' ; exit 2 }
Write-Host "Login CSRF len: $($token.Length)"
$body = "_csrf=$token&username=admin&password=comfortschool"
$loginResp = curl.exe -i http://localhost:3000/admin/login -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data $body -b cookie.txt -c cookie.txt
$loginResp | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

function Get-Admin-Csrf {
  $h = curl.exe -s http://localhost:3000/admin -b cookie.txt
  return Extract-CsrfFromHtml $h
}

# upload banner (fetch CSRF right before POST)
$csrf = Get-Admin-Csrf
Write-Host "csrf for banner: $csrf"
$uploadBanner = curl.exe -i http://localhost:3000/admin/banners -X POST -F "image=@test-image.png" -F "title=E2E Banner" -F "subtitle=E2E Sub" -F "_csrf=$csrf" -b cookie.txt -c cookie.txt
$uploadBanner | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

# find banner id
$adminHtml = curl.exe -s http://localhost:3000/admin -b cookie.txt
$m = [regex]::Match($adminHtml, '/admin/banners/([0-9]+)/delete')
if ($m.Success) { $bannerId = $m.Groups[1].Value; Write-Host "Found banner id: $bannerId" } else { Write-Host 'No banner id found' }

if ($bannerId) {
  $csrf = Get-Admin-Csrf
  Write-Host "csrf for toggle: $csrf"
  $toggle = curl.exe -i http://localhost:3000/admin/banners/$bannerId/toggle -X POST -F "_csrf=$csrf" -b cookie.txt -c cookie.txt
  $toggle | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

  $csrf = Get-Admin-Csrf
  Write-Host "csrf for delete: $csrf"
  $del = curl.exe -i http://localhost:3000/admin/banners/$bannerId/delete -X POST -F "_csrf=$csrf" -b cookie.txt -c cookie.txt
  $del | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }
}

# upload gallery
$csrf = Get-Admin-Csrf
Write-Host "csrf for gallery: $csrf"
$uploadGallery = curl.exe -i http://localhost:3000/admin/gallery -X POST -F "image=@test-image.png" -F "title=E2E Gallery" -F "caption=test" -F "_csrf=$csrf" -b cookie.txt -c cookie.txt
$uploadGallery | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

# create staff
$csrf = Get-Admin-Csrf
Write-Host "csrf for staff: $csrf"
$createStaff = curl.exe -i http://localhost:3000/admin/staff -X POST -F "photo=@test-image.png" -F "name=E2E Staff" -F "role=Teacher" -F "description=desc" -F "_csrf=$csrf" -b cookie.txt -c cookie.txt
$createStaff | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

# create page
$csrf = Get-Admin-Csrf
Write-Host "csrf for page: $csrf"
$pageBody = "_csrf=$csrf&title=E2E Page&slug=e2e-page-2&content=Hello+from+E2E"
$createPage = curl.exe -i http://localhost:3000/admin/pages -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data $pageBody -b cookie.txt -c cookie.txt
$createPage | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

# contact
$contactPage = curl.exe -s http://localhost:3000/contact -c cookie2.txt
$csrfContact = Extract-CsrfFromHtml $contactPage
Write-Host "contact csrf: $csrfContact"
$contactBody = "_csrf=$csrfContact&name=Tester&email=test%40example.com&phone=9999999999&message=hello"
$contactSubmit = curl.exe -i http://localhost:3000/contact -X POST -H 'Content-Type: application/x-www-form-urlencoded' --data $contactBody -b cookie2.txt -c cookie2.txt
$contactSubmit | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

# logout
$logout = curl.exe -i http://localhost:3000/admin/logout -b cookie.txt -c cookie.txt
$logout | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

$adminAfter = curl.exe -I http://localhost:3000/admin -b cookie.txt
$adminAfter | Select-String -Pattern 'HTTP/1.1|Location:' | ForEach-Object { Write-Host $_ }

Write-Host 'E2E script finished.'
