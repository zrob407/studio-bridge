local RunService = game:GetService("RunService")
local StudioTestService = game:GetService("StudioTestService")

if RunService:IsRunning() then
	error("a play session is already running; call play_stop first")
end

local mode = params.mode or "play"

if mode ~= "play" and mode ~= "run" then
	error('mode must be "play" or "run"')
end

local bridgeState = shared.__ClaudeBridge

if not bridgeState then
	bridgeState = {lastPlayEnded = 0}
	shared.__ClaudeBridge = bridgeState
end

local remaining = 3 - (os.clock() - bridgeState.lastPlayEnded)

if remaining > 0 then
	task.wait(remaining)
end

task.spawn(function()
	local ok, problem = pcall(function()
		if mode == "run" then
			return StudioTestService:ExecuteRunModeAsync(params.args or {})
		end

		return StudioTestService:ExecutePlayModeAsync(params.args or {})
	end)

	bridgeState.lastPlayEnded = os.clock()

	if not ok then
		warn("[ClaudeStudioBridge] play_start failed: " .. tostring(problem))
	end
end)

return "starting " .. mode .. " mode; the server and client windows appear in studio_list once they connect"
