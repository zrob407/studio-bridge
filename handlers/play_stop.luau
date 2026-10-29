local RunService = game:GetService("RunService")
local StudioTestService = game:GetService("StudioTestService")

if not RunService:IsRunning() or not RunService:IsServer() then
	error("this window is not a running server session")
end

task.delay(0.3, function()
	local ok, problem = pcall(function()
		StudioTestService:EndTest(params.result or "stopped by bridge")
	end)

	if not ok then
		RunService:Stop()
	end
end)

return "stop requested"
