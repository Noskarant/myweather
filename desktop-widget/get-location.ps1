# Geolocation via the Windows Runtime provider (honours Windows privacy settings).
# No external API key, administrator privilege or IP-based estimation.
$ErrorActionPreference='Stop'
try {
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $type=[Windows.Devices.Geolocation.Geolocator,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
  $positionType=[Windows.Devices.Geolocation.Geoposition,Windows.Devices.Geolocation,ContentType=WindowsRuntime]
  $locator=[Activator]::CreateInstance($type)
  $operation=$locator.GetGeopositionAsync()
  $method=[System.WindowsRuntimeSystemExtensions].GetMethods() |
    Where-Object {
      $_.Name -eq 'AsTask' -and $_.IsGenericMethodDefinition -and
      $_.GetParameters().Count -eq 1 -and
      $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1'
    } | Select-Object -First 1
  if($null -eq $method){throw 'Windows Runtime geolocation bridge unavailable'}
  $asTask=$method.MakeGenericMethod($positionType)
  $task=$asTask.Invoke($null,@($operation))
  if(-not $task.Wait(9000)){throw 'Windows location timed out'}
  $coords=$task.Result.Coordinate.Point.Position
  $lat=[double]$coords.Latitude
  $lon=[double]$coords.Longitude
  if([double]::IsNaN($lat) -or [double]::IsNaN($lon) -or [Math]::Abs($lat) -gt 90 -or [Math]::Abs($lon) -gt 180){throw 'Invalid coordinates'}
  @{ok=$true;lat=$lat;lon=$lon} | ConvertTo-Json -Compress
} catch {
  @{ok=$false;error=$_.Exception.Message} | ConvertTo-Json -Compress
}
