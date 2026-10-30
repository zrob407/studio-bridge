local function sortedKeyframesOf(sequence)
	local keyframes = sequence:GetKeyframes()

	table.sort(keyframes, function(a, b)
		return a.Time < b.Time
	end)

	return keyframes
end

local function motorsOf(rig)
	local motors = {}

	for _, descendant in ipairs(rig:GetDescendants()) do
		if descendant:IsA("Motor6D") and descendant.Part1 then
			motors[descendant.Part1.Name] = descendant
		end
	end

	return motors
end

local function posesAt(keyframes, time, cache)
	local before = keyframes[1]
	local after = keyframes[#keyframes]

	for _, keyframe in ipairs(keyframes) do
		if keyframe.Time <= time then
			before = keyframe
		end
	end

	for index = #keyframes, 1, -1 do
		if keyframes[index].Time >= time then
			after = keyframes[index]
		end
	end

	local function posesOf(keyframe)
		if cache and cache[keyframe] then
			return cache[keyframe]
		end

		local found = {}

		for _, descendant in ipairs(keyframe:GetDescendants()) do
			if descendant:IsA("Pose") and descendant.Weight > 0 then
				found[descendant.Name] = descendant.CFrame
			end
		end

		if cache then
			cache[keyframe] = found
		end

		return found
	end

	local alpha = if after.Time == before.Time then 0 else (time - before.Time) / (after.Time - before.Time)
	local fromPoses = posesOf(before)
	local toPoses = posesOf(after)
	local blended = {}

	for name, goal in pairs(toPoses) do
		blended[name] = (fromPoses[name] or CFrame.identity):Lerp(goal, alpha)
	end

	for name, start in pairs(fromPoses) do
		if not toPoses[name] then
			blended[name] = start:Lerp(CFrame.identity, alpha)
		end
	end

	return blended
end

local function applyPoses(motors, blended)
	for name, motor in pairs(motors) do
		motor.Transform = blended[name] or CFrame.identity
	end
end
