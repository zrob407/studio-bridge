local target = resolve(params.path)

local function sortedKeyframes(sequence)
	local keyframes = sequence:GetKeyframes()

	table.sort(keyframes, function(a, b)
		return a.Time < b.Time
	end)

	return keyframes
end

local function lengthOf(keyframes)
	return if #keyframes > 0 then keyframes[#keyframes].Time else 0
end

local function triple(x, y, z)
	return string.format("(%.2f, %.2f, %.2f)", x, y, z)
end

local function describePose(pose)
	local rx, ry, rz = pose.CFrame:ToEulerAnglesXYZ()
	local position = pose.CFrame.Position

	return string.format(
		"%s pos %s rot %s weight %.2f %s/%s",
		pose.Name,
		triple(position.X, position.Y, position.Z),
		triple(math.deg(rx), math.deg(ry), math.deg(rz)),
		pose.Weight,
		pose.EasingStyle.Name,
		pose.EasingDirection.Name
	)
end

if target:IsA("KeyframeSequence") then
	local keyframes = sortedKeyframes(target)
	local joints = {}
	local jointOrder = {}
	local markers = {}

	for _, keyframe in ipairs(keyframes) do
		for _, descendant in ipairs(keyframe:GetDescendants()) do
			if descendant:IsA("Pose") and not joints[descendant.Name] then
				joints[descendant.Name] = true
				table.insert(jointOrder, descendant.Name)
			end
		end

		for _, child in ipairs(keyframe:GetChildren()) do
			if child:IsA("KeyframeMarker") then
				table.insert(markers, string.format("%s at %.3fs = %s", child.Name, keyframe.Time, child.Value))
			end
		end
	end

	local lines = {
		string.format(
			"%s: %.3fs, %d keyframes, %d joints, loop %s, priority %s",
			pathOf(target),
			lengthOf(keyframes),
			#keyframes,
			#jointOrder,
			tostring(target.Loop),
			target.Priority.Name
		),
		"joints: " .. table.concat(jointOrder, ", "),
	}

	if #markers > 0 then
		table.insert(lines, "markers: " .. table.concat(markers, "; "))
	end

	for _, keyframe in ipairs(keyframes) do
		local poses = {}

		for _, descendant in ipairs(keyframe:GetDescendants()) do
			if descendant:IsA("Pose") and descendant.Weight > 0 then
				table.insert(poses, descendant)
			end
		end

		if params.detail then
			table.insert(lines, string.format("t=%.3f (%d posed)", keyframe.Time, #poses))

			for _, pose in ipairs(poses) do
				table.insert(lines, "  " .. describePose(pose))
			end
		else
			table.insert(lines, string.format("t=%.3f %d posed", keyframe.Time, #poses))
		end
	end

	return table.concat(lines, "\n")
end

local lines = {}
local animations = 0

for _, descendant in ipairs(target:GetDescendants()) do
	if descendant:IsA("KeyframeSequence") then
		local keyframes = sortedKeyframes(descendant)

		table.insert(lines, string.format(
			"%s %.3fs %d keyframes loop %s priority %s",
			pathOf(descendant),
			lengthOf(keyframes),
			#keyframes,
			tostring(descendant.Loop),
			descendant.Priority.Name
		))
	elseif descendant:IsA("Animation") then
		animations += 1
	end
end

if #lines == 0 then
	return "no KeyframeSequences under " .. pathOf(target) .. " (" .. animations .. " Animation instances)"
end

table.insert(lines, animations .. " Animation instances under " .. pathOf(target))

return table.concat(lines, "\n")
