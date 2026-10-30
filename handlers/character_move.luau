local Players = game:GetService("Players")
local PathfindingService = game:GetService("PathfindingService")
local MAX_SECONDS = 45

local player = Players.LocalPlayer

if not player then
	error("character_move must run in the client window of a playtest")
end

local character = player.Character

if not character then
	local waited = 0

	while not player.Character and waited < 10 do
		task.wait(0.2)
		waited += 0.2
	end

	character = player.Character
end

local humanoid = if character then character:FindFirstChildOfClass("Humanoid") else nil
local root = if humanoid then humanoid.RootPart else nil

if not humanoid or not root then
	error("the player has no character with a Humanoid yet")
end

local action = params.action

local function describe()
	return string.format(
		"at %s, state %s, health %d/%d, walk speed %g",
		formatVector(root.Position),
		humanoid:GetState().Name,
		humanoid.Health,
		humanoid.MaxHealth,
		humanoid.WalkSpeed
	)
end

local function targetOf()
	if params.position then
		return toVector3(params.position, "position")
	end

	if params.path then
		local instance = resolve(params.path)

		if instance:IsA("Model") then
			return instance:GetPivot().Position
		elseif instance:IsA("BasePart") then
			return instance.Position
		end

		error(pathOf(instance) .. " is not a Model or a BasePart")
	end

	error("give a position or a path to walk to")
end

local function walkTo(point, deadline)
	local finished = false
	local reached = false
	local connection = humanoid.MoveToFinished:Connect(function(success)
		finished = true
		reached = success
	end)

	humanoid:MoveTo(point)

	while not finished and os.clock() < deadline and (root.Position - point).Magnitude > (params.stopDistance or 3) do
		task.wait(0.1)
	end

	connection:Disconnect()

	return reached or (root.Position - point).Magnitude <= (params.stopDistance or 3)
end

if action == "get" then
	return describe()
elseif action == "jump" then
	humanoid.Jump = true
	humanoid:ChangeState(Enum.HumanoidStateType.Jumping)
	task.wait(0.4)

	return "jumped, " .. describe()
elseif action == "stop" then
	humanoid:MoveTo(root.Position)

	return "stopped, " .. describe()
elseif action == "move_to" then
	local point = targetOf()
	local limit = math.min(params.timeout or 20, MAX_SECONDS)
	local deadline = os.clock() + limit
	local method = "direct"
	local reached = false

	if params.pathfind ~= false then
		local path = PathfindingService:CreatePath({AgentRadius = 2, AgentHeight = 5, AgentCanJump = true})
		local ok = pcall(function()
			path:ComputeAsync(root.Position, point)
		end)

		if ok and path.Status == Enum.PathStatus.Success then
			method = "pathfinding"

			for _, waypoint in ipairs(path:GetWaypoints()) do
				if os.clock() >= deadline then
					break
				end

				if waypoint.Action == Enum.PathWaypointAction.Jump then
					humanoid.Jump = true
				end

				humanoid:MoveTo(waypoint.Position)

				local legDeadline = math.min(deadline, os.clock() + 4)

				while os.clock() < legDeadline and (root.Position - waypoint.Position).Magnitude > 3 do
					task.wait(0.1)
				end
			end

			reached = (root.Position - point).Magnitude <= (params.stopDistance or 3)
		end
	end

	if not reached and method == "direct" then
		reached = walkTo(point, deadline)
	end

	return string.format(
		"%s the target %s by %s, %.1f studs left, %s",
		if reached then "reached" else "did not reach",
		formatVector(point),
		method,
		(root.Position - point).Magnitude,
		describe()
	)
end

error("action must be get, move_to, jump or stop")
