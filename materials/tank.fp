// Fragment shader: textured base colour with a fixed directional sun plus
// ambient fill, giving the flat-shaded low-poly look some form.

varying mediump vec2 var_texcoord0;
varying mediump vec3 var_normal;

uniform lowp sampler2D tex0;
uniform lowp vec4 tint;

void main()
{
    lowp vec4 base = texture2D(tex0, var_texcoord0) * tint;
    mediump vec3 sun = normalize(vec3(0.4, 0.9, 0.35));
    mediump float ndl = max(dot(normalize(var_normal), sun), 0.0);
    mediump float shade = 0.45 + 0.55 * ndl;   // ambient + diffuse
    gl_FragColor = vec4(base.rgb * shade, base.a);
}
