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

local function jointSamples(keyframes, cache)
	if cache and cache.joints then
		return cache.joints
	end

	local joints = {}

	for _, keyframe in ipairs(keyframes) do
		for _, descendant in ipairs(keyframe:GetDescendants()) do
			if descendant:IsA("Pose") and descendant.Weight > 0 then
				local list = joints[descendant.Name]

				if not list then
					list = {}
					joints[descendant.Name] = list
				end

				table.insert(list, {time = keyframe.Time, frame = descendant.CFrame})
			end
		end
	end

	if cache then
		cache.joints = joints
	end

	return joints
end

local function posesAt(keyframes, time, cache)
	local blended = {}

	for name, samples in pairs(jointSamples(keyframes, cache)) do
		local before = samples[1]
		local after = samples[#samples]

		for _, sample in ipairs(samples) do
			if sample.time <= time then
				before = sample
			end
		end

		for index = #samples, 1, -1 do
			if samples[index].time >= time then
				after = samples[index]
			end
		end

		local alpha = if after.time == before.time then 0 else (time - before.time) / (after.time - before.time)

		blended[name] = before.frame:Lerp(after.frame, alpha)
	end

	return blended
end

local function applyPoses(motors, blended)
	for name, motor in pairs(motors) do
		motor.Transform = blended[name] or CFrame.identity
	end
end
