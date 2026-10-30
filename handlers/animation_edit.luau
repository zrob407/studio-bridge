local source = resolve(params.path)

if not source:IsA("KeyframeSequence") then
	error(pathOf(source) .. " is not a KeyframeSequence")
end

if type(params.operations) ~= "table" or #params.operations == 0 then
	error("operations is required")
end

local TOLERANCE = 0.0005
local sequence = source

if params.copyName then
	sequence = source:Clone()
	sequence.Name = params.copyName
	sequence.Parent = if params.copyParent then resolve(params.copyParent) else source.Parent
end

local function sortedKeyframes()
	local keyframes = sequence:GetKeyframes()

	table.sort(keyframes, function(a, b)
		return a.Time < b.Time
	end)

	return keyframes
end

local function lengthNow()
	local keyframes = sortedKeyframes()

	return if #keyframes > 0 then keyframes[#keyframes].Time else 0
end

local lines = {}
local backup = sequence:Clone()

local applied, problem = pcall(function()
	for index, operation in ipairs(params.operations) do
		local kind = operation.op

		if kind == "scale_time" then
			if type(operation.factor) ~= "number" or operation.factor <= 0 then
				error("operation " .. index .. ": factor must be a positive number")
			end

			for _, keyframe in ipairs(sequence:GetKeyframes()) do
				keyframe.Time *= operation.factor
			end

			table.insert(lines, string.format("scaled time by %.3f, length now %.3fs", operation.factor, lengthNow()))
		elseif kind == "shift_time" then
			local keyframes = sequence:GetKeyframes()

			if type(operation.seconds) ~= "number" then
				error("operation " .. index .. ": seconds is required")
			end

			for _, keyframe in ipairs(keyframes) do
				if keyframe.Time + operation.seconds < 0 then
					error("operation " .. index .. ": that shift would move a keyframe before time 0")
				end
			end

			for _, keyframe in ipairs(keyframes) do
				keyframe.Time += operation.seconds
			end

			table.insert(lines, string.format("shifted by %.3fs, length now %.3fs", operation.seconds, lengthNow()))
		elseif kind == "reverse" then
			local length = lengthNow()

			for _, keyframe in ipairs(sequence:GetKeyframes()) do
				keyframe.Time = length - keyframe.Time
			end

			table.insert(lines, "reversed")
		elseif kind == "delete_keyframes" then
			local removed = 0

			for _, keyframe in ipairs(sequence:GetKeyframes()) do
				local drop = false

				for _, time in ipairs(operation.times or {}) do
					if math.abs(keyframe.Time - time) <= TOLERANCE then
						drop = true
					end
				end

				if operation.from and operation.to and keyframe.Time >= operation.from - TOLERANCE and keyframe.Time <= operation.to + TOLERANCE then
					drop = true
				end

				if drop then
					keyframe:Destroy()
					removed += 1
				end
			end

			table.insert(lines, "deleted " .. removed .. " keyframe(s)")
		elseif kind == "add_marker" then
			if type(operation.time) ~= "number" or type(operation.name) ~= "string" then
				error("operation " .. index .. ": add_marker needs time and name")
			end

			local host

			for _, keyframe in ipairs(sequence:GetKeyframes()) do
				if math.abs(keyframe.Time - operation.time) <= TOLERANCE then
					host = keyframe
				end
			end

			if not host then
				host = Instance.new("Keyframe")
				host.Time = operation.time
				host.Parent = sequence
			end

			local marker = Instance.new("KeyframeMarker")
			marker.Name = operation.name
			marker.Value = tostring(operation.value or "")
			marker.Parent = host
			table.insert(lines, string.format("added marker %s at %.3fs", operation.name, operation.time))
		elseif kind == "set" then
			if operation.loop ~= nil then
				sequence.Loop = operation.loop == true
			end

			if operation.priority then
				local ok, item = pcall(function()
					return Enum.AnimationPriority[operation.priority]
				end)

				if not ok then
					error("operation " .. index .. ": unknown priority " .. tostring(operation.priority))
				end

				sequence.Priority = item
			end

			if operation.name then
				sequence.Name = operation.name
			end

			table.insert(lines, "set properties")
		else
			error("operation " .. index .. ": op must be scale_time, shift_time, reverse, delete_keyframes, add_marker or set")
		end
	end
end)

if not applied then
	if params.copyName then
		sequence:Destroy()
	else
		for _, child in ipairs(sequence:GetChildren()) do
			child:Destroy()
		end

		for _, child in ipairs(backup:GetChildren()) do
			child.Parent = sequence
		end

		sequence.Name = backup.Name
		sequence.Loop = backup.Loop
		sequence.Priority = backup.Priority
	end

	error(tostring(problem) .. " (nothing was changed)", 0)
end

backup:Destroy()

table.insert(lines, 1, pathOf(sequence))

return table.concat(lines, "\n")
