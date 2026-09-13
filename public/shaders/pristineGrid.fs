#version 330 core
in vec3 nearPoint; // nearPoint calculated in vertex shader
in vec3 farPoint; // farPoint calculated in vertex shader
in mat4 viewMat;
in mat4 projMat;

out vec4 outColor;

vec4 grid(vec3 fragPos3D, float scale) {
    vec2 uv = fragPos3D.xz * scale;
	vec2 duv = fwidth(uv);
	float fadeOutAlpha = 0.0;
    vec2 targetWidth = vec2(0.005);
    // world space width, using phone-wire AA:
    //vec2 drawWidth = max(targetWidth, duv);
    // or constant 1px width:
    vec2 drawWidth = duv;
    vec2 gridUV = 1. - abs(fract(uv) * 2. - 1.);
    vec2 grid_line = 1. - smoothstep(drawWidth - duv, drawWidth + duv, gridUV);
    grid_line *= clamp(targetWidth/drawWidth, fadeOutAlpha, 1.); // fade out when duv > targetWidth
    grid_line = mix(grid_line, vec2(fadeOutAlpha), clamp(duv, 0., 1.)); // remove the moire pattern when duv >= 1.0
    vec4 color = vec4(vec3(0.3), mix(grid_line.x, 1.0, grid_line.y));  
    // no need to use smoothstep, the color.a has been smoothed
    vec2 main_grid_line = 1. - step(drawWidth, abs(uv));
    color.z += main_grid_line.x; // z axis
    color.x += main_grid_line.y; // x axis
    return color;
}

float computeDepth(vec3 pos) {
    vec4 clip_space_pos = projMat * viewMat * vec4(pos.xyz, 1.0);
    float ndc_z = (clip_space_pos.z / clip_space_pos.w);
    return (ndc_z + 1.) * 0.5;
}

void main() {
    float t = -nearPoint.y / (farPoint.y - nearPoint.y);
    vec3 fragPos3D = nearPoint + t * (farPoint - nearPoint);
    gl_FragDepth = computeDepth(fragPos3D);
    outColor = (grid(fragPos3D, 1) + grid(fragPos3D, 0.1)) * float(t > 0);
}
